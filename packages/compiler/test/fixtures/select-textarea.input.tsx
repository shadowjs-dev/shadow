export const a = (
  <form>
    <select name="c" multiple value={list()}>
      <optgroup label="g">
        <option value="a">A</option>
        <option>Plain</option>
      </optgroup>
    </select>
    <textarea name="t" value={text()} />
  </form>
);
