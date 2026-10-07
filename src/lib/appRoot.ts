type AppRootDocument = Pick<Document, 'getElementById'>

export function requireAppRoot(documentLike: AppRootDocument): HTMLElement {
  const root = documentLike.getElementById('root')

  if (!root) {
    throw new Error('SUPA app root #root is missing')
  }

  return root
}
