/** Activity categories. The database function create_activity() holds the same list; a test keeps the two identical. */
export const ACTIVITY_CATEGORIES = [
  { id: 'cafes', label: 'Cafes', icon: 'cafe' },
  { id: 'restaurants', label: 'Restaurants', icon: 'restaurant' },
  { id: 'comedy', label: 'Comedy', icon: 'happy' },
  { id: 'music', label: 'Music', icon: 'musical-notes' },
  { id: 'board_games', label: 'Board games', icon: 'dice' },
  { id: 'bowling', label: 'Bowling', icon: 'baseball' },
  { id: 'sports', label: 'Sports', icon: 'football' },
  { id: 'workshops', label: 'Workshops', icon: 'hammer' },
  { id: 'art', label: 'Art', icon: 'color-palette' },
  { id: 'walking', label: 'Walking groups', icon: 'walk' },
  { id: 'travel', label: 'Travel', icon: 'airplane' },
  { id: 'adventure', label: 'Adventure', icon: 'rocket' },
  { id: 'local', label: 'Local experiences', icon: 'location' },
] as const;
export type ActivityCategoryId = (typeof ACTIVITY_CATEGORIES)[number]['id'];
export const activityLabel = (id: string): string => ACTIVITY_CATEGORIES.find((c) => c.id === id)?.label ?? id;
