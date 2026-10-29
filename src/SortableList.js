export default function SortableList({
  items,
  onChange,
  itemLabel,
  listLabel,
  getItemKey = (item) => item.id,
  renderItem,
}) {
  const moveItem = (index, offset) => {
    const destination = index + offset;
    if (destination < 0 || destination >= items.length) return;

    const reordered = [...items];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(reordered);
  };

  return (
    <ol className="sortable-list" aria-label={listLabel}>
      {items.map((item, index) => (
        <li className="sortable-item" key={getItemKey(item)}>
          <div className="sortable-item-content">{renderItem(item, index)}</div>
          <div className="sortable-controls" aria-label={`${itemLabel} ${index + 1} order`}>
            <button
              type="button"
              aria-label={`Move ${itemLabel} ${index + 1} up`}
              disabled={index === 0}
              onClick={() => moveItem(index, -1)}
            >↑</button>
            <button
              type="button"
              aria-label={`Move ${itemLabel} ${index + 1} down`}
              disabled={index === items.length - 1}
              onClick={() => moveItem(index, 1)}
            >↓</button>
          </div>
        </li>
      ))}
    </ol>
  );
}
