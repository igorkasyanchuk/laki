// The renderer's CSS (Vite reads this for the build and the dev server). BlockNote's styles for suggested edits (its
// Yjs collaboration, which Laki's editors never make: .bn-suggestion-node, .bn-suggestion-mark) are left out. Two of
// their :has() rules together made every DOM change anywhere in the window restyle every element once the Specs page
// had loaded them: a brainstorm with long files, 90 ms a change, the app nearly stuck. Its slash menu's
// .bn-suggestion-menu stays.
const SUGGESTED = /bn-suggestion-(node|mark)/

export default {
  plugins: [
    {
      postcssPlugin: 'laki-no-suggested-edits',
      Rule(r) {
        if (!SUGGESTED.test(r.selector)) return
        // "not inside a suggested edit" is every element here; what's left of each selector naming one goes
        const kept = r.selectors.map(s => s.replaceAll(':not(.bn-suggestion-node *)', '')).filter(s => !SUGGESTED.test(s))
        if (kept.length) r.selectors = kept
        else r.remove()
      },
    },
  ],
}
