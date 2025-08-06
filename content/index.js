// Clean content script based on markdown-viewer patterns
// Simplified Mithril-based rendering

console.log('[Content] Starting Jupyter Notebook Viewer')
console.log('[Content] args available:', !!window.args)
console.log('[Content] Mithril available:', typeof m !== 'undefined')

var $ = document.querySelector.bind(document)

// Check if args is available
if (!window.args) {
  console.error('[Content] window.args not available, extension not properly injected')
  document.body.innerHTML = '<div style="padding:20px;color:red;">Extension initialization failed - window.args not available</div>'
  throw new Error('Extension not properly initialized')
}

console.log('[Content] Args received:', window.args)

var state = {
  theme: window.args.theme,
  raw: window.args.raw,
  themes: window.args.themes,
  content: window.args.content,
  compiler: window.args.compiler,
  html: '',
  notebook: null,
  toc: '',
  reload: {
    interval: null,
    ms: 1000,
    nb: false,
  },
  _themes: {
    'github': 'light',
    'github-dark': 'dark',
    'jupyter': 'light',
    'custom': 'auto',
  }
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.message === 'reload') {
    location.reload(true)
  }
  else if (req.message === 'theme') {
    console.log('[Content] Theme change received:', req.theme, 'from:', state.theme)
    state.theme = req.theme
    m.redraw()
  }
  else if (req.message === 'themes') {
    state.themes = req.themes
    m.redraw()
  }
  else if (req.message === 'raw') {
    state.raw = req.raw
    state.reload.nb = true
    m.redraw()
  }
  else if (req.message === 'autoreload') {
    clearInterval(state.reload.interval)
  }
})

var oncreate = {
  html: () => {
    update()
  }
}

var onupdate = {
  html: () => {
    if (state.reload.nb) {
      state.reload.nb = false
      update(true)
    }
  },
  theme: () => {
    if (state.content.mathjax) {
      setTimeout(() => {
        if (window.MathJax && MathJax.Hub) {
          MathJax.Hub.Queue(['Typeset', MathJax.Hub, '_html'])
        }
      }, 0)
    }
  }
}

var update = (update) => {
  console.log('[Content] Update function called')
  var markdown = $('#_markdown')
  if (!markdown) {
    console.warn('[Content] #_markdown element not found')
    return
  }
  
  if (state.content.syntax && typeof Prism !== 'undefined') {
    console.log('[Content] Running Prism syntax highlighting')
    Prism.highlightAllUnder(markdown)
  }
  
  // Try both MathJax and KaTeX
  if (state.content.mathjax) {
    if (window.MathJax && MathJax.Hub) {
      console.log('[Content] Running MathJax rendering')
      MathJax.Hub.Queue(['Typeset', MathJax.Hub, '_markdown'])
    } else if (typeof renderMathInElement !== 'undefined') {
      console.log('[Content] Running KaTeX rendering')
      renderMathInElement(markdown, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '\\[', right: '\\]', display: true},
          {left: '\\(', right: '\\)', display: false},
          {left: '$', right: '$', display: false},
          {left: '\\begin{equation}', right: '\\end{equation}', display: true},
          {left: '\\begin{align}', right: '\\end{align}', display: true},
          {left: '\\begin{alignat}', right: '\\end{alignat}', display: true},
          {left: '\\begin{gather}', right: '\\end{gather}', display: true},
          {left: '\\begin{multline}', right: '\\end{multline}', display: true}
        ]
      })
    } else {
      console.warn('[Content] No math rendering library available')
    }
  }
  
  // Make content visible after processing
  setTimeout(() => {
    if (markdown) markdown.style.visibility = 'visible'
    var tocEl = $('#_toc')
    if (tocEl && state.content.toc && !state.raw) {
      console.log('[Content] Making TOC visible')
      tocEl.style.visibility = 'visible'
    }
  }, 100)
}

// TOC generation function from markdown-viewer
var toc = (() => {
  var walk = (regex, string, group, result = [], match = regex.exec(string)) =>
    !match ? result : walk(regex, string, group, result.concat(!group ? match[1] :
      group.reduce((all, name, index) => (all[name] = match[index + 1], all), {})))
  return {
    render: (html) =>
      walk(
        /<h([1-6]) id="(.*?)">(.*?)<\/h[1-6]>/gs,
        html,
        ['level', 'id', 'title']
      )
      .reduce((toc, {id, title, level}) => toc +=
        '<div class="_ul">'.repeat(level) +
        '<a href="#' + id + '">' + title.replace(/<a[^>]+>/g, '').replace(/<\/a>/g, '') + '</a>' +
        '</div>'.repeat(level)
      , '')
  }
})()

var render = (nbtext) => {
  console.log('[Content] Render function called with notebook text length:', nbtext.length)
  
  try {
    // Parse notebook JSON
    var nbjson = JSON.parse(nbtext)
    console.log('[Content] JSON parsed successfully, cells:', nbjson.cells ? nbjson.cells.length : 0)
    
    // Check if notebook library is available
    if (typeof nb === 'undefined') {
      console.error('[Content] Notebook parsing library (nb) not available')
      state.html = '<div style="padding:20px;color:red;">Notebook parsing library not loaded</div>'
      m.redraw()
      return
    }
    
    // Parse and render notebook
    console.log('[Content] Parsing notebook with nb library')
    state.html = nb.parse(nbjson).render().innerHTML
    console.log('[Content] Notebook parsed successfully, HTML length:', state.html.length)
    
    // Generate TOC if enabled
    if (state.content.toc) {
      console.log('[Content] Generating TOC')
      state.toc = toc.render(state.html)
      console.log('[Content] TOC generated, length:', state.toc.length)
    }
    
    // Store raw notebook for raw mode
    state.notebook = nbtext
    
    m.redraw()
    
  } catch (e) {
    console.error('[Content] Failed to parse notebook:', e.message)
    state.html = '<div style="padding:20px;color:red;">Failed to parse notebook: ' + e.message + '</div>'
    state.notebook = nbtext
    m.redraw()
  }
}

function mount () {
  console.log('[Content] Mount function called')
  var pre = $('pre')
  if (!pre) {
    console.error('[Content] No <pre> element found')
    return
  }
  
  console.log('[Content] Pre element found, hiding it')
  pre.style.display = 'none'
  var nbtext = pre.innerText
  console.log('[Content] Notebook text length:', nbtext.length)
  
  if (typeof m === 'undefined') {
    console.error('[Content] Mithril not available')
    document.body.innerHTML = '<div style="padding:20px;color:red;">Mithril library not loaded</div>'
    return
  }
  
  console.log('[Content] Mounting Mithril component')
  m.mount($('body'), {
    oninit: () => {
      console.log('[Content] Mithril oninit called, rendering notebook')
      render(nbtext)
    },
    view: () => {
      console.log('[Content] View function called, state.html length:', state.html ? state.html.length : 0)
      
      if (state.html) {
        // Apply CSS classes to body
        var color = state._themes[state.theme] === 'dark' ||
          (state._themes[state.theme] === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light'

        $('body').classList.remove(...Array.from($('body').classList).filter((name) => /^_theme|_color/.test(name)))

        // Apply theme classes - simplified, no wide option
        var theme = (/github(-dark)?/.test(state.theme) ? 'markdown-body' : 'markdown-theme') + 
          ' notebook-viewer'
        var dom = []
        
        // Add dynamic theme CSS link FIRST (like markdown-viewer)
        dom.push(m('link#_theme', {
          onupdate: onupdate.theme,
          rel: 'stylesheet', type: 'text/css',
          href: chrome.runtime.getURL(`/themes/${state.theme}.css`),
        }))
        
        // Apply body classes AFTER theme link (like markdown-viewer)
        $('body').classList.add(`_theme-${state.theme}`, `_color-${color}`)
        console.log('[Content] Applied body classes:', `_theme-${state.theme}`, `_color-${color}`)
        
        if (state.raw) {
          if (state.content.syntax) {
            dom.push(m('#_markdown', {oncreate: oncreate.html, onupdate: onupdate.html, class: theme},
              m.trust(`<pre class="language-json"><code class="language-json">${state.notebook}</code></pre>`)
            ))
          } else {
            dom.push(m('pre#_markdown', {oncreate: oncreate.html, onupdate: onupdate.html}, state.notebook))
          }
        } else {
          dom.push(m('#_markdown', {oncreate: oncreate.html, onupdate: onupdate.html, class: theme},
            m.trust(state.html)
          ))
        }
        
        // Add TOC if enabled and available
        if (state.content.toc && state.toc) {
          console.log('[Content] Adding TOC to view')
          
          // Add TOC toggle button
          dom.push(m('#_toc-toggle', {
            onclick: () => {
              $('body').classList.toggle('_toc-visible')
            },
            title: 'Toggle Table of Contents'
          }, '☰'))
          
          // Add TOC panel
          dom.push(m('#_toc.tex2jax-ignore', m.trust(state.toc)))
        }
        
        return dom
      }

      return m('div', 'Loading...')
    }
  })
}

mount()