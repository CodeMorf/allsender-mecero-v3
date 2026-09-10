import type { MenuItem } from '../types'

/**
 * Keeps category navigation dynamic while respecting the order configured by
 * the branch. Items without a published order remain available alphabetically
 * after ordered categories.
 */
export function menuCategoryNames(items: Pick<MenuItem, 'categoryName' | 'categorySortOrder'>[]): string[] {
  const orderByName = new Map<string, number | undefined>()
  for (const item of items) {
    const name = item.categoryName?.trim()
    if (!name) continue
    const current = orderByName.get(name)
    if (current === undefined || (item.categorySortOrder !== undefined && item.categorySortOrder < current)) {
      orderByName.set(name, item.categorySortOrder)
    }
  }

  return Array.from(orderByName.entries())
    .sort(([leftName, leftOrder], [rightName, rightOrder]) => {
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) return leftOrder - rightOrder
      if (leftOrder !== undefined && rightOrder === undefined) return -1
      if (leftOrder === undefined && rightOrder !== undefined) return 1
      return leftName.localeCompare(rightName, 'es', { sensitivity: 'base' })
    })
    .map(([name]) => name)
}
