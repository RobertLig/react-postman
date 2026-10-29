import { fireEvent, render, screen } from "@testing-library/react";
import SortableList from "./SortableList";

test("uses item ids as keys when no key selector is provided", () => {
  const items = [{ id: "first" }, { id: "second" }];
  const onChange = jest.fn();

  render(
    <SortableList
      items={items}
      onChange={onChange}
      itemLabel="stop"
      listLabel="Stops"
      renderItem={(item) => item.id}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Move stop 2 up" }));

  expect(onChange).toHaveBeenCalledWith([items[1], items[0]]);
});
