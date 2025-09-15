import { useMemo, useState, useEffect, useRef } from 'react'
import './App.css'
import { searchAllProviders, type ProviderResult } from './lib/providers'


type Retailer = 'B&Q' | 'Screwfix' | 'Toolstation'

// Enhanced product matching with multiple strategies
function calculateSimilarity(str1: string, str2: string): number {
  // Normalize both strings
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
  
  const norm1 = normalize(str1)
  const norm2 = normalize(str2)
  
  if (norm1 === norm2) return 1.0
  
  // Strategy 1: Extract key product terms
  const getKeyTerms = (s: string) => {
    const words = s.split(' ').filter(w => w.length > 2)
    // Remove common words that don't help with matching
    const stopWords = new Set([
      'the', 'and', 'or', 'for', 'with', 'set', 'pack', 'kit', 'tool', 'tools',
      'professional', 'pro', 'premium', 'standard', 'basic', 'deluxe', 'heavy',
      'duty', 'diy', 'home', 'garden', 'indoor', 'outdoor', 'black', 'white',
      'red', 'blue', 'green', 'yellow', 'orange', 'silver', 'gold', 'chrome'
    ])
    return words.filter(w => !stopWords.has(w))
  }
  
  // Strategy 1.5: Extract product specifications (sizes, quantities, etc.)
  const extractSpecs = (s: string) => {
    const specs = []
    // Look for common patterns like "10pc", "5L", "25mm", "1/2 inch", etc.
    const patterns = [
      /\d+pc/gi,           // 10pc, 5pc
      /\d+[ml]l?/gi,       // 5L, 500ml
      /\d+mm/gi,           // 25mm, 10mm
      /\d+\/\d+\s*inch/gi, // 1/2 inch, 3/4 inch
      /\d+\.\d+\s*inch/gi, // 1.5 inch
      /\d+x\d+/gi,         // 10x5, 2x4
      /\d+kg/gi,           // 5kg, 2.5kg
      /\d+w/gi,            // 100W, 50W
      /\d+v/gi,            // 12V, 24V
    ]
    
    for (const pattern of patterns) {
      const matches = s.match(pattern)
      if (matches) {
        specs.push(...matches.map(m => m.toLowerCase()))
      }
    }
    
    return specs
  }
  
  const terms1 = getKeyTerms(norm1)
  const terms2 = getKeyTerms(norm2)
  const specs1 = extractSpecs(norm1)
  const specs2 = extractSpecs(norm2)
  
  // Strategy 2: Check for exact term matches
  const commonTerms = terms1.filter(term => terms2.includes(term))
  const totalTerms = new Set([...terms1, ...terms2]).size
  
  // Strategy 2.5: Check for specification matches (very important for product matching)
  const commonSpecs = specs1.filter(spec => specs2.includes(spec))
  const totalSpecs = new Set([...specs1, ...specs2]).size
  
  if (totalTerms === 0 && totalSpecs === 0) return 0
  
  const termSimilarity = totalTerms > 0 ? commonTerms.length / totalTerms : 0
  const specSimilarity = totalSpecs > 0 ? commonSpecs.length / totalSpecs : 0
  
  // Strategy 3: Check for partial matches (e.g., "screwdriver" matches "screwdrivers")
  let partialMatches = 0
  for (const term1 of terms1) {
    for (const term2 of terms2) {
      if (term1.includes(term2) || term2.includes(term1)) {
        partialMatches++
        break
      }
    }
  }
  
  const partialSimilarity = partialMatches / Math.max(terms1.length, terms2.length)
  
  // Strategy 4: Levenshtein distance for overall similarity
  const longer = norm1.length > norm2.length ? norm1 : norm2
  const shorter = norm1.length > norm2.length ? norm2 : norm1
  
  if (longer.length === 0) return 1.0
  
  const distance = levenshteinDistance(longer, shorter)
  const levenshteinSimilarity = (longer.length - distance) / longer.length
  
  // Strategy 5: Check for brand/model numbers (e.g., "ABC123" should match "ABC-123")
  const extractNumbers = (s: string): string[] => s.match(/\d+/g) || []
  const numbers1 = extractNumbers(norm1)
  const numbers2 = extractNumbers(norm2)
  const numberMatches = numbers1.filter((n: string) => numbers2.includes(n)).length
  const numberSimilarity = numbers1.length > 0 && numbers2.length > 0 
    ? numberMatches / Math.max(numbers1.length, numbers2.length) 
    : 0
  
  // Weighted combination of all strategies
  const weights = {
    term: 0.25,     // Exact term matches
    spec: 0.35,     // Specifications are very important (sizes, quantities, etc.)
    partial: 0.2,   // Partial matches
    levenshtein: 0.15, // Overall similarity
    numbers: 0.05   // Model numbers help but less important
  }
  
  const finalSimilarity = 
    (termSimilarity * weights.term) +
    (specSimilarity * weights.spec) +
    (partialSimilarity * weights.partial) +
    (levenshteinSimilarity * weights.levenshtein) +
    (numberSimilarity * weights.numbers)
  
  return Math.min(finalSimilarity, 1.0)
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = []
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  return matrix[str2.length][str1.length]
}

function App() {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<ProviderResult[] | null>(null)
  const [totalCounts, setTotalCounts] = useState<Record<Retailer, number>>({ 'B&Q': 0, 'Screwfix': 0, 'Toolstation': 0 })
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    const saved = localStorage.getItem('searchHistory')
    return saved ? JSON.parse(saved) : []
  })
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSearchQuery = useRef<string>('')

  const canSearch = useMemo(() => query.trim().length > 1 && !isSearching, [query, isSearching])

  // Group similar products across retailers
  const productGroups = useMemo(() => {
    if (!results) return new Map()
    
    const groups = new Map<string, ProviderResult[]>()
    
    for (const result of results) {
      // Create a normalized key for grouping similar products
      const normalizedTitle = result.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
      
      // Try to find existing group with similar title
      let foundGroup = false
      let bestMatch = { key: '', similarity: 0 }
      
      for (const [key] of groups) {
        const similarity = calculateSimilarity(normalizedTitle, key)
        if (similarity > bestMatch.similarity) {
          bestMatch = { key, similarity }
        }
      }
      
      // Use a lower threshold and also check for partial matches
      if (bestMatch.similarity > 0.5) { // Lowered from 0.7 to 0.5
        groups.get(bestMatch.key)?.push(result)
        foundGroup = true
        
        // Debug logging (uncomment to see matching scores)
        // if (bestMatch.similarity > 0.6) {
        //   console.log(`Matched: "${result.title}" with "${bestMatch.key}" (${(bestMatch.similarity * 100).toFixed(1)}%)`)
        // }
      }
      
      if (!foundGroup) {
        groups.set(normalizedTitle, [result])
      }
    }
    
    return groups
  }, [results])

  // Find cheapest price for each product group
  const cheapestPrices = useMemo(() => {
    const cheapest = new Map<string, number>()
    
    for (const [key, group] of productGroups) {
      const prices = group.filter((r: ProviderResult) => r.price !== null).map((r: ProviderResult) => r.price as number)
      if (prices.length > 0) {
        cheapest.set(key, Math.min(...prices))
      }
    }
    
    return cheapest
  }, [productGroups])

  // Find cheapest price across all results (for backward compatibility)
  // const cheapestPrice = useMemo(() => {
  //   if (!results) return null
  //   const prices = results.filter(r => r.price !== null).map(r => r.price as number)
  //   return prices.length > 0 ? Math.min(...prices) : null
  // }, [results])

  // Save search history
  useEffect(() => {
    localStorage.setItem('searchHistory', JSON.stringify(searchHistory.slice(0, 10)))
  }, [searchHistory])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuery('')
        setShowHistory(false)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Click outside to close search history
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element
      // Close if clicking outside the search wrapper
      if (showHistory && !target.closest('.search-wrapper')) {
        setShowHistory(false)
      }
    }
    
    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showHistory])

  const [displayLimit, setDisplayLimit] = useState(15)
  const [sortBy, setSortBy] = useState<'relevance' | 'price-low' | 'price-high'>('relevance')
  const [showDuplicates, setShowDuplicates] = useState(false)

  const grouped = useMemo(() => {
    const map: Partial<Record<Retailer, { items: ProviderResult[]; displayed: number }>> = {}
    if (results) {
      let sortedResults: ProviderResult[] = []
      
      if (showDuplicates) {
        // Group similar products and show only the cheapest from each group
        const uniqueProducts: ProviderResult[] = []
        
        for (const [, group] of productGroups) {
          if (group.length === 0) continue
          
          // Sort group by price (cheapest first)
          const sortedGroup = [...group].sort((a: ProviderResult, b: ProviderResult) => {
            if (a.price === null && b.price === null) return 0
            if (a.price === null) return 1
            if (b.price === null) return -1
            return a.price - b.price
          })
          
          // Add the cheapest option from this group
          uniqueProducts.push(sortedGroup[0])
        }
        
        sortedResults = uniqueProducts
      } else {
        // Show all raw results (default behavior)
        sortedResults = [...results]
      }
      
      if (sortBy === 'price-low') {
        sortedResults.sort((a, b) => {
          if (a.price === null && b.price === null) return 0
          if (a.price === null) return 1
          if (b.price === null) return -1
          return a.price - b.price
        })
      } else if (sortBy === 'price-high') {
        sortedResults.sort((a, b) => {
          if (a.price === null && b.price === null) return 0
          if (a.price === null) return 1
          if (b.price === null) return -1
          return b.price - a.price
        })
      }
      
      // Then group by retailer and limit
      for (const r of sortedResults) {
        const g = (map[r.retailer] ||= { items: [], displayed: 0 })
        // Limit display based on current limit
        if (g.items.length < displayLimit) {
          g.items.push(r)
          g.displayed += 1
        }
      }
    }
    return map
  }, [results, displayLimit, sortBy, productGroups, showDuplicates])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) return
    setIsSearching(true)
    setShowHistory(false)
    const searchTerm = query.trim()
    lastSearchQuery.current = searchTerm
    setDisplayLimit(15) // Reset display limit for new search
    setSortBy('relevance') // Reset sort to relevance for new search
    
    // Add to history if not duplicate
    if (!searchHistory.includes(searchTerm)) {
      setSearchHistory(prev => [searchTerm, ...prev.slice(0, 9)])
    }
    
    ;(async () => {
      try {
        console.log('Starting search for:', searchTerm)
        // Fetch 75 results per retailer to get accurate counts
        const data = await searchAllProviders(searchTerm, 75)
        console.log('Search completed, results:', data.length)
        setResults(data)
        
        // Calculate actual totals for each retailer
        const counts: Record<Retailer, number> = { 'B&Q': 0, 'Screwfix': 0, 'Toolstation': 0 }
        data.forEach(item => {
          counts[item.retailer]++
        })
        setTotalCounts(counts)
      } catch (err) {
        console.error('Search error:', err)
        setResults([])
        setTotalCounts({ 'B&Q': 0, 'Screwfix': 0, 'Toolstation': 0 })
      } finally {
        setIsSearching(false)
      }
    })()
  }

  function handleHistoryClick(term: string) {
    setQuery(term)
    setShowHistory(false)
    // Auto-submit the search
    setTimeout(() => {
      const form = document.querySelector('.search-app .search') as HTMLFormElement
      form?.requestSubmit()
    }, 0)
  }

  function clearSearch() {
    setQuery('')
    setResults(null)
    setTotalCounts({ 'B&Q': 0, 'Screwfix': 0, 'Toolstation': 0 })
    setDisplayLimit(10)
    inputRef.current?.focus()
  }

  function loadMore() {
    // Increase display limit to show more results
    setDisplayLimit(prev => prev + 15)
  }

  // Add error boundary for debugging
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      console.error('Global error:', e.error)
    })
    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled promise rejection:', e.reason)
    })
  }

  return (
    <div className="search-app">
      <header className="header">
        <div className="header-content">
          <div className="brand-container">
            <h1 className="brand">
              <img
                className="brand-logo"
                src="https://i.postimg.cc/zBxHN857/merrick-logo-cropped.jpg"
                alt="Merrick Shaw logo"
                decoding="async"
                loading="eager"
              />
              <div>
                <span>PriceFinder Pro</span>
                <div className="brand-subtitle">by Merrick Shaw Home & Garden Care</div>
              </div>
            </h1>
          </div>
          <form className="search" onSubmit={handleSubmit}>
            <div className="search-wrapper">
              <input
                ref={inputRef}
                className="input"
                type="text"
                placeholder="Search B&Q, Screwfix, Toolstation…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onClick={() => {
                  // Toggle history on click - close if already open
                  if (showHistory) {
                    setShowHistory(false)
                  } else {
                    setShowHistory(true)
                  }
                }}
                aria-label="Search products"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  className="clear-button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
              {showHistory && searchHistory.length > 0 && !isSearching && (
                <div className="search-history">
                  <div className="history-header">
                    Recent searches
                    <button
                      type="button"
                      className="history-close"
                      onClick={() => setShowHistory(false)}
                      aria-label="Close search history"
                    >
                      ✕
                    </button>
                  </div>
                  {searchHistory.map((term, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="history-item"
                      onClick={() => handleHistoryClick(term)}
                    >
                      <span className="history-icon">🕐</span>
                      <span className="history-text">{term}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="button" type="submit" disabled={!canSearch}>
              {isSearching ? 'Searching…' : 'Search'}
            </button>
          </form>
          
          {/* Sorting controls - only show when there are results */}
          {results && results.length > 0 && (
            <div className="sort-controls">
              <label htmlFor="sort-select" className="sort-label">Sort:</label>
              <select
                id="sort-select"
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'relevance' | 'price-low' | 'price-high')}
              >
                <option value="relevance">Relevance</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
              
              <label className="duplicate-toggle">
                <input
                  type="checkbox"
                  checked={showDuplicates}
                  onChange={(e) => setShowDuplicates(e.target.checked)}
                />
                <span className="toggle-label">Find best deals (group similar products)</span>
              </label>
            </div>
          )}
        </div>
      </header>
      
      {/* Spacer div that takes up actual space in the document flow */}
      <div className="header-spacer"></div>
      
      <main className="main-content">
        <section className="grid">
          {(['B&Q', 'Screwfix', 'Toolstation'] as Retailer[]).map((name) => {
            const group = grouped[name]
            const totalForRetailer = totalCounts[name] || 0
            const shown = group?.items.length || 0
            const hasItems = shown > 0
            const isLoading = isSearching
            const cardClass = [
              'card',
              isLoading ? 'is-loading' : '',
              hasItems ? 'has-results' : '',
            ].filter(Boolean).join(' ')
            const placeholderText = !results
              ? 'Search to see results'
              : totalForRetailer === 0
              ? 'No results found'
              : ''
            return (
              <div className={cardClass} key={name}>
              <div className="card-header">
                <span className="retailer">
                  {renderLogo(name)}
                  <span className="retailer-name">{name}</span>
                </span>
              </div>
              <div className="card-body">
                  {isLoading && (
                    <div className="skeleton-loader">
                      <div className="skeleton-item">
                        <div className="skeleton-thumb" />
                        <div className="skeleton-meta">
                          <div className="skeleton-title" />
                          <div className="skeleton-price" />
                        </div>
                      </div>
                      <div className="skeleton-item">
                        <div className="skeleton-thumb" />
                        <div className="skeleton-meta">
                          <div className="skeleton-title" />
                          <div className="skeleton-price" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {!isLoading && (
                    <>
                      <div className="placeholder">{placeholderText}</div>
                      <div className="result">
                        <span className="result-title">
                          {totalForRetailer > 0 ? `Showing ${shown} of ${totalForRetailer}+ results` : ''}
                        </span>
                      </div>
                    </>
                  )}

                  <ul className="list">
                    {group?.items.map((r, idx) => {
                        // Check if this is the cheapest price for this specific product group
                        const productKey = r.title
                          .toLowerCase()
                          .replace(/[^\w\s]/g, '')
                          .replace(/\s+/g, ' ')
                          .trim()
                        const groupCheapestPrice = cheapestPrices.get(productKey)
                        const isCheapest = showDuplicates && r.price !== null && groupCheapestPrice !== undefined && r.price === groupCheapestPrice
                        return (
                          <li className={`item ${isCheapest ? 'cheapest' : ''}`} key={`${r.url || r.title}-${idx}`}>
                        {r.imageUrl ? (
                              r.url ? (
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="thumb-wrap">
                                  <img 
                                    className="thumb" 
                                    src={r.imageUrl} 
                                    alt="" 
                                    loading="lazy" 
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                      e.currentTarget.parentElement!.classList.add('thumb-error')
                                    }}
                                  />
                                </a>
                              ) : (
                                <div className="thumb-wrap">
                                  <img 
                                    className="thumb" 
                                    src={r.imageUrl} 
                                    alt="" 
                                    loading="lazy" 
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                      e.currentTarget.parentElement!.classList.add('thumb-error')
                                    }}
                                  />
                                </div>
                              )
                        ) : (
                          <div className="thumb placeholder-thumb" />
                        )}
                        <div className="meta">
                              {r.url ? (
                                <a className="title" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                              ) : (
                                <span className="title">{r.title}</span>
                              )}
                              <div className="price">
                                {r.price !== null ? `£${r.price.toFixed(2)}` : '—'}
                                {isCheapest && <span className="cheapest-badge">BEST DEAL</span>}
                              </div>
                        </div>
                      </li>
                        )
                      })}
                  </ul>

                  </div>
              </div>
            )
          })}
        </section>
        
        {results && results.length > displayLimit * 3 && (
          <div className="view-more-container">
            <button 
              className="button view-more-all" 
              type="button" 
              onClick={loadMore}
            >
              View More Results
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function renderLogo(name: 'B&Q' | 'Screwfix' | 'Toolstation') {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24' }
  switch (name) {
    case 'B&Q':
      return (
        <svg {...common} className="logo-svg"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ff6b00"/><text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">B&Q</text></svg>
      )
    case 'Screwfix':
      return (
        <svg {...common} className="logo-svg"><rect x="2" y="4" width="20" height="16" rx="3" fill="#1a72e8"/><text x="12" y="16" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">SF</text></svg>
      )
    case 'Toolstation':
      return (
        <svg {...common} className="logo-svg"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ffd500"/><text x="12" y="16" textAnchor="middle" fontSize="7" fontWeight="700" fill="#1a1a1a">TS</text></svg>
      )
  }
}

export default App
