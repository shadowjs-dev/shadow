export const a = <ul>{items().map((i) => <li onClick={() => pick(i)}>{i}</li>)}</ul>;
