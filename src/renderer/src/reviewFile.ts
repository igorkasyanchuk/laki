// #C1: a file to open in the Review tab (the status bar's conflicts list): kept until that workspace's Review shows it
// (FullReview reads it as its files come), and said by an event to one open already
export const reviewFile = { ws: '', path: '' }
export function reviewFileGo(ws: string, path: string) {
  Object.assign(reviewFile, { ws, path })
  window.dispatchEvent(new CustomEvent('laki-review-file'))
}
