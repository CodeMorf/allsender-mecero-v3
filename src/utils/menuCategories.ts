import type { MenuCategory, MenuItem } from '../types'

export type CategoryFilterId = number | 'ALL' | 'OTHER'

export interface CategoryFilterOption {
  id: CategoryFilterId
  name: string
  sortOrder?: number
  count: number
}

/**
 * Nombre que hay que evitar mostrar: cuando la metadata no trae nombre de
 * categoría se genera algo como "Categoría 77", que no le dice nada al usuario.
 */
const GENERIC_CATEGORY_NAME = /^Categor[ií]a\s*\d*$/i

/**
 * Normalizes text for tolerant category comparisons:
 * removes accents, lowercases and trims excessive whitespace.
 */
export function normalizeCategoryText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Checks if a menu item belongs to the selected category:
 * 1. Matches by stable numeric categoryId first
 * 2. Falls back to normalized categoryName comparison when ID is not available
 * 3. Handles 'ALL' and 'OTHER' (unassigned / generic) cleanly
 */
export function isItemInCategory(
  item: MenuItem,
  selectedId: CategoryFilterId,
  selectedName?: string
): boolean {
  if (selectedId === 'ALL') return true

  const hasNoCat = itemBelongsToOthers(item)
  if (selectedId === 'OTHER') return hasNoCat

  // Un producto sin categoría asignada no debe aparecer bajo un id concreto,
  // ni siquiera si la API le dio un número de categoría que no se pudo resolver.
  if (hasNoCat) return false

  if (typeof selectedId === 'number') {
    if (item.categoryId != null && Number(item.categoryId) === selectedId) {
      return true
    }
  }

  // Fallback: match by normalized text if name is supplied
  if (selectedName && item.categoryName) {
    const itemNorm = normalizeCategoryText(item.categoryName)
    const selNorm = normalizeCategoryText(selectedName)
    if (itemNorm && selNorm && itemNorm === selNorm) {
      return true
    }
  }

  return false
}

/**
 * Un producto va a "Otros" cuando no tiene categoría usable: sin id, sin
 * nombre, o con un nombre genérico que no aporta nada al usuario.
 */
function itemBelongsToOthers(item: MenuItem): boolean {
  if (item.categoryId == null || Number(item.categoryId) <= 0) return true
  const name = item.categoryName?.trim()
  if (!name) return true
  return name === 'Otros' || GENERIC_CATEGORY_NAME.test(name)
}

/**
 * Builds stable category filter options for UI chips/tabs:
 * - Always includes 'ALL' ('Todos los productos' / 'Todos')
 * - Leverages explicit categories from the API (ordered by sort_order)
 * - Automatically derives categories from items if explicit categories are absent
 * - Groups unassigned items into 'OTHER' ('Otros')
 */
export function buildCategoryFilterOptions(
  items: MenuItem[],
  explicitCategories?: MenuCategory[],
  allLabel = 'Todos los productos'
): CategoryFilterOption[] {
  const options: CategoryFilterOption[] = [
    { id: 'ALL', name: allLabel, count: items.length, sortOrder: -1 }
  ]

  const knownIds = new Set<number>()
  const explicitList = Array.isArray(explicitCategories) ? explicitCategories : []

  // 1. Process explicit categories from the API
  for (const cat of explicitList) {
    if (!cat || cat.id <= 0) continue
    knownIds.add(cat.id)
    const name = cat.name?.trim() || `Categoría ${cat.id}`
    const count = items.filter(it => isItemInCategory(it, cat.id, name)).length
    options.push({
      id: cat.id,
      name,
      sortOrder: cat.sortOrder,
      count,
    })
  }

  // 2. Discover any additional categories present in items but not in explicit list
  const pendingItemsByCategory = new Map<number, { name: string; sortOrder?: number }>()

  for (const item of items) {
    // Un producto sin categoría resoluble ya cuenta en 'Otros': no debe generar
    // además su propia categoría, o aparecería dos veces en el selector.
    if (itemBelongsToOthers(item)) continue

    if (item.categoryId != null && item.categoryId > 0 && !knownIds.has(item.categoryId)) {
      if (!pendingItemsByCategory.has(item.categoryId)) {
        const name = item.categoryName?.trim() && !GENERIC_CATEGORY_NAME.test(item.categoryName)
          ? item.categoryName.trim()
          : `Categoría ${item.categoryId}`
        pendingItemsByCategory.set(item.categoryId, {
          name,
          sortOrder: item.categorySortOrder,
        })
      }
    }
  }

  for (const [id, meta] of pendingItemsByCategory.entries()) {
    const count = items.filter(it => isItemInCategory(it, id, meta.name)).length
    options.push({
      id,
      name: meta.name,
      sortOrder: meta.sortOrder,
      count,
    })
  }

  // Count items that ended up in 'Otros'
  const explicitOtherCount = items.filter(it => isItemInCategory(it, 'OTHER')).length
  if (explicitOtherCount > 0) {
    options.push({
      id: 'OTHER',
      name: 'Otros',
      sortOrder: 99999,
      count: explicitOtherCount,
    })
  }

  // Sort: 'ALL' first (-1), then by sortOrder, then alphabetically in Spanish
  return [
    options[0],
    ...options.slice(1).sort((a, b) => {
      if (a.id === 'OTHER') return 1
      if (b.id === 'OTHER') return -1
      if (a.sortOrder !== undefined && b.sortOrder !== undefined && a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder
      }
      if (a.sortOrder !== undefined && b.sortOrder === undefined) return -1
      if (a.sortOrder === undefined && b.sortOrder !== undefined) return 1
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    })
  ]
}

/**
 * Backward compatibility: returns category names ordered by published sort order.
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
