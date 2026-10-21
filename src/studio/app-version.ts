/** The entry hash identifies the code actually loaded, unlike the ?v= bookmark. */
export function studioEntry(html:string):string|null{
  return html.match(/<script\b[^>]*\bsrc=["'](\/assets\/studio-[\w-]+\.js)["'][^>]*>/i)?.[1]??null;
}
export function loadedStudioEntry():string|null{
  if(typeof document==='undefined')return null;
  for(const script of document.scripts){const path=script.getAttribute('src');if(path&&/^\/assets\/studio-[\w-]+\.js$/.test(path))return path;}
  return null;
}
