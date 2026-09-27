import type { ModelSelectGroup } from "../ModelConfigSelect.js";

export function filterModelSelectGroups(
  groups: readonly ModelSelectGroup[],
  query: string,
): readonly ModelSelectGroup[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return groups;
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => {
      const searchable =
        `${group.label} ${item.name} ${item.searchText ?? ""} ${item.value}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}
