/** Qualification only. Keep our pre-gain measurement branch separate from the
 * engine's own connections. AudioBufferSource.disconnect() must still disconnect
 * every destination the engine connected; it must not dismantle our recorder.
 * Source start/stop, buffer, rates, gains and onended are never intercepted here.
 * This helper does NOT qualify audibility after the production gain nodes. */
export function captureSourceTap(source:AudioBufferSourceNode,tap:AudioNode){
  const connect=source.connect,disconnect=source.disconnect,destinations=new Set<AudioNode|AudioParam>();
  Reflect.apply(connect,source,[tap]);
  source.connect=((destination:AudioNode|AudioParam,...args:unknown[])=>{
    if(destination===tap)throw Error('Le moteur ne doit pas utiliser le point de mesure.');
    const result=Reflect.apply(connect,source,[destination,...args]);destinations.add(destination);return result;
  }) as typeof source.connect;
  source.disconnect=((...args:unknown[])=>{
    // Current BA engines use the no-argument form. Fail closed if that contract
    // changes rather than silently altering an unqualified overload.
    if(args.length)throw Error('Surcharge de déconnexion non qualifiée par le point de mesure.');
    for(const destination of destinations)Reflect.apply(disconnect,source,[destination]);
    destinations.clear();
  }) as typeof source.disconnect;
  let released=false;
  return ()=>{
    if(released)return;released=true;
    source.connect=connect;source.disconnect=disconnect;
    Reflect.apply(disconnect,source,[tap]);
  };
}
