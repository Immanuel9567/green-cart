// Product search for GreenCart.
//
// THE PROBLEM THIS FIXES
// The catalogue is named by brand and materials — "Bauhaus Chronograph Mono",
// "Obsidian Low-Top Sneaker", "Sculptural Arc Desk Luminaire". Shoppers do not
// search like that. They type "watch", "shoes", "lamp". The old search compared
// the query against the title, description, category name and tags with a plain
// substring test, so "watch" found nothing even though a chronograph was sitting
// on the page. That is not a missing feature, it is a search box that lies.
//
// HOW IT SEARCHES
//   1. Every product is reduced to a haystack of weighted fields: title and tags
//      weigh most, category and specs next, description least. A match in a
//      heavier field ranks higher, so "Monolith" puts the capsule speaker above a
//      printer that merely mentions the word.
//   2. The query is tokenised, lowercased and accent-folded, so "Lumière" is
//      found by "lumiere".
//   3. Each token is expanded through a small synonym table — "watch" becomes
//      chronograph/timepiece/automatic, "shoes" becomes sneaker/runner/footwear.
//      The table is data, not magic: it lives in SYNONYMS below.
//   4. Tokens are matched as whole-word prefixes, so "head" matches "headphone"
//      and "over-ear" but "art" does not match "cart".
//   5. ALL tokens must match something (AND across tokens), which is what people
//      expect from a shop search: "black steel" narrows rather than widens.
//
// NOTHING HERE INVENTS CATALOGUE COPY. The synonyms map a shopper's word onto
// words that already exist in the catalogue or its categories. No product gains
// a description it did not have, and no result is fabricated to fill the page.

(function (root) {
  // Words a shopper uses, mapped to words the catalogue actually contains.
  // Keys are matched exactly after normalisation; values are added as synonyms.
  // Keep these honest: an entry here should be a word a real customer would type
  // for something this shop genuinely sells.
  const SYNONYMS = {
    watch: ['chronograph', 'timepiece', 'timepieces', 'automatic', 'dial', 'wrist'],
    watches: ['chronograph', 'timepiece', 'timepieces', 'automatic', 'dial', 'wrist'],
    timepiece: ['watch', 'chronograph', 'automatic'],
    clock: ['timepiece', 'chronograph'],
    headphone: ['audio', 'over-ear', 'monolith', 'driver', 'drivers'],
    headphones: ['audio', 'over-ear', 'monolith', 'driver', 'drivers'],
    earphone: ['audio', 'earbuds', 'in-ear', 'monitor'],
    earphones: ['audio', 'earbuds', 'in-ear', 'monitor'],
    earbuds: ['audio', 'in-ear', 'monitor', 'earphone'],
    speaker: ['audio', 'capsule', 'wireless', 'sound'],
    speakers: ['audio', 'capsule', 'wireless', 'sound'],
    music: ['audio', 'sound', 'speaker', 'headphone'],
    shoe: ['sneaker', 'runner', 'footwear', 'low-top'],
    shoes: ['sneaker', 'runner', 'footwear', 'low-top'],
    sneaker: ['shoe', 'footwear', 'runner'],
    sneakers: ['shoe', 'footwear', 'runner'],
    trainer: ['sneaker', 'runner', 'footwear'],
    trainers: ['sneaker', 'runner', 'footwear'],
    running: ['runner', 'sneaker', 'footwear'],
    lamp: ['luminaire', 'light', 'lighting', 'desk'],
    light: ['lamp', 'luminaire', 'lighting'],
    lighting: ['lamp', 'luminaire', 'light'],
    desk: ['workspace', 'luminaire', 'board', 'tech'],
    workspace: ['desk', 'tech', 'board'],
    keyboard: ['mechanical', 'board', 'tech', 'workspace'],
    keycap: ['keyboard', 'mechanical', 'board'],
    charger: ['charging', 'magsafe', 'deck', 'tech', 'power'],
    charging: ['charger', 'magsafe', 'power', 'tech'],
    power: ['charger', 'charging', 'battery'],
    battery: ['power', 'charging', 'charger'],
    bag: ['backpack', 'commuter', 'carry'],
    backpack: ['bag', 'commuter', 'carry'],
    rucksack: ['backpack', 'bag', 'commuter'],
    glasses: ['eyewear', 'polarized', 'sunglasses'],
    sunglasses: ['eyewear', 'polarized', 'glasses'],
    eyewear: ['glasses', 'polarized', 'lumiere'],
    coffee: ['french', 'press', 'ceramic', 'brew'],
    brewer: ['french', 'press', 'coffee'],
    flask: ['thermal', 'bottle', 'drink'],
    bottle: ['flask', 'thermal', 'drink'],
    mug: ['flask', 'ceramic', 'thermal'],
    home: ['living', 'decor', 'lamp', 'press'],
    decor: ['living', 'lamp', 'luminaire'],
    gift: ['badge', 'flagship', 'limited', 'artisan', 'design'],
    cheap: ['price', 'low'],
    premium: ['flagship', 'artisan', 'design', 'award', 'titanium']
  };

  // Fields in the order they are scored. `weight` is the points added per field
  // that matches; `tags` and `title` dominate so an exact product name wins.
  const FIELDS = [
    { key: 'title', weight: 8 },
    { key: 'tags', weight: 6 },
    { key: 'categoryName', weight: 4 },
    { key: 'specs', weight: 3 },
    { key: 'description', weight: 1 }
  ];

  // "Lumière" -> "lumiere", so a shopper without an accented keyboard can find it.
  function fold(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function tokens(value) {
    return fold(value).split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Everything a product can be found by, as one lowercase string per field.
  function haystack(product) {
    const specs = Array.isArray(product.specs)
      ? product.specs.map(spec => (spec && (spec.label || spec.value) ? `${spec.label || ''} ${spec.value || ''}` : '')).join(' ')
      : '';
    const tags = Array.isArray(product.tags) ? product.tags.join(' ') : '';
    return {
      title: fold(product.title || product.name || ''),
      tags: fold(`${tags} ${product.badge || ''}`),
      categoryName: fold(`${product.category || ''} ${product.categoryName || ''}`),
      specs: fold(specs),
      description: fold(product.description || '')
    };
  }

  // A token matches a field when it equals a word there, or is a prefix of one.
  // Whole-word prefixing stops "art" matching "cart" while keeping "head" -> "headphone".
  function fieldMatches(fieldText, token) {
    if (!fieldText) return false;
    if (fieldText.indexOf(token) === -1) return false; // cheap rejection first
    const words = fieldText.split(/[^a-z0-9]+/);
    return words.some(word => word.startsWith(token));
  }

  // Expand one typed token into the forms worth trying, typed form first so an
  // exact name always outranks a synonym hit.
  function expand(token) {
    const extra = SYNONYMS[token] || [];
    const singles = token.length > 3 && token.endsWith('s') ? [token.slice(0, -1)] : [];
    return [token, ...singles, ...extra.filter(Boolean)];
  }

  function scoreProduct(product, queryTokens) {
    const hay = haystack(product);
    let score = 0;
    for (const typed of queryTokens) {
      const forms = expand(typed);
      let bestForToken = 0;
      FIELDS.forEach(field => {
        const text = hay[field.key];
        if (!text) return;
        // Exact typed form beats a synonym; a synonym still counts, at 60%.
        if (fieldMatches(text, typed) || forms.slice(1).some(alias => fieldMatches(text, alias))) {
          const exact = fieldMatches(text, typed);
          bestForToken = Math.max(bestForToken, Math.round(field.weight * (exact ? 1 : 0.6)));
        }
      });
      if (!bestForToken) return 0; // AND semantics: one unmatched token excludes the product
      score += bestForToken;
    }
    return score;
  }

  // Returns products ordered by relevance. An empty query returns everything,
  // untouched, so the caller's own sort still applies to a plain browse.
  function searchProducts(products, query) {
    const list = Array.isArray(products) ? products : [];
    const queryTokens = tokens(query);
    if (!queryTokens.length) return list.slice();
    return list
      .map(product => ({ product, score: scoreProduct(product, queryTokens) }))
      .filter(entry => entry.score > 0)
      // Stable tie-break on the catalogue's own order, so equal scores do not
      // shuffle between keystrokes.
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(entry => entry.product);
  }

  const api = { searchProducts, tokens, fold, SYNONYMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GreenCartSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
