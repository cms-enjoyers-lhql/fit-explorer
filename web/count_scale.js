// Display transforms only: add/integrate counts BEFORE applying this mapping.
export function countFloor(maximum, requested) {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new RangeError('Count scale needs a positive finite maximum');
  if (requested === undefined) return Math.min(.01, maximum / 100);
  if (!Number.isFinite(requested) || requested <= 0 || requested >= maximum)
    throw new RangeError('Log minimum must be positive and below the count-axis maximum');
  return requested;
}

// Preserve precision for a nearby floor while avoiding overflow for tiny floors.
function logRatio(a, b) {
  const relative=(a-b)/b;
  return Number.isFinite(relative)?Math.log1p(relative):Math.log(a)-Math.log(b);
}

export function countFraction(value, maximum, scale='linear', minimum) {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0)
    throw new RangeError('Count scale needs finite counts and a positive maximum');
  if (scale === 'linear') return Math.max(0, value) / maximum;
  if (scale !== 'log') throw new RangeError('Unknown count scale');
  const floor = countFloor(maximum, minimum);
  return logRatio(Math.max(floor, value), floor) / logRatio(maximum, floor);
}

export function countTicks(maximum, scale='linear', divisions=4, minimum) {
  if (scale === 'linear') return Array.from({length:divisions+1}, (_,i)=>maximum*i/divisions);
  const floor=countFloor(maximum, minimum), ticks=[floor];
  for(let power=Math.ceil(Math.log10(floor));power<=Math.floor(Math.log10(maximum));power++) {
    const value=10**power;
    if(value>floor*(1+1e-10)) ticks.push(value);
  }
  return ticks;
}

export function formatCountTick(value) {
  if (value !== 0 && Math.abs(value) < 1e-4)
    return value.toExponential(2).replace(/\.?0+e/, 'e');
  return value.toLocaleString('en-US', {maximumSignificantDigits:6});
}
