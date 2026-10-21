/** JSON data equality independent of provider/object key insertion order.
 * Array order and every persisted value remain significant. */
export function plannerRecoveryFingerprint(value:unknown):string{
 return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}
