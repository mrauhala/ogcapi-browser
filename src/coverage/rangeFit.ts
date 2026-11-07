// A range against its domain, by the rule a schema can't check: "The shape and axis names of each NdArray or
// TiledNdArray object MUST correspond to the domain axes defined by "domain", while single-valued axes MAY be
// omitted", and where "shape" is present, "the product of its values MUST equal the number of elements in the
// "values" array". Checks says by it what's wrong in any response, and the map's grids, polygons and points what they
// can't read. The profile reads by its own rule, which lets an unknown name of one value by. No DOM.

type Json = Record<string, unknown>;

export interface RangeMisfit {
  // What's wrong, starting with the parameter's id
  message: string;
  // The member of the range it's about, to point at
  member: 'axisNames' | 'shape' | 'values';
}

const count = (n: number) => n.toLocaleString('en-US');
const isAxis = (lengths: Record<string, number>, name: string) => Object.prototype.hasOwnProperty.call(lengths, name);

// lengths: how many values each of the domain's axes has, a composite axis by its tuples or polygons. Without
// axisNames, the values are as many as the axes make together. A TiledNdArray's values are in its tiles, so only its
// names and shape are checked
export function rangeMisfit(id: string, range: Json, lengths: Record<string, number>): RangeMisfit | null {
  const values = Array.isArray(range.values) ? range.values : null;
  const names = Array.isArray(range.axisNames) ? range.axisNames.map(String) : null;
  const shape = Array.isArray(range.shape) ? range.shape.map(Number) : null;
  if (names && shape && names.length !== shape.length) {
    return { member: 'shape', message: `${id}: axisNames has ${names.length} names, shape has ${shape.length}` };
  }
  if (shape && values) {
    const product = shape.reduce((a, b) => a * b, 1);
    if (product !== values.length) {
      return { member: 'values', message: `${id}: shape ${shape.join(' × ')} makes ${count(product)} values, and values has ${count(values.length)}` };
    }
  }
  if (!names) {
    const expected = Object.values(lengths).reduce((a, b) => a * b, 1);
    if (values && !shape && values.length !== expected) {
      return { member: 'values', message: `${id}: the domain's axes make ${count(expected)} values, and values has ${count(values.length)}` };
    }
    return null;
  }
  const stranger = names.find(name => !isAxis(lengths, name));
  if (stranger !== undefined) return { member: 'axisNames', message: `${id}: axisNames has "${stranger}", which isn't an axis of the domain` };
  if (shape) {
    const at = names.findIndex((name, i) => shape[i] !== lengths[name]);
    if (at >= 0) {
      return { member: 'shape', message: `${id}: shape says ${names[at]} has ${count(shape[at])} values, and the axis has ${count(lengths[names[at]])}` };
    }
  } else if (values) {
    const expected = names.reduce((a, name) => a * lengths[name], 1);
    if (values.length !== expected) {
      return { member: 'values', message: `${id}: axisNames ${names.join(', ')} make ${count(expected)} values, and values has ${count(values.length)}` };
    }
  }
  const left = Object.keys(lengths).find(name => lengths[name] > 1 && !names.includes(name));
  if (left !== undefined) return { member: 'axisNames', message: `${id}: axisNames has no ${left}, and ${left} has ${count(lengths[left])} values` };
  return null;
}
