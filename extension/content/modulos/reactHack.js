(function() {
  console.log('[PartyHazz-ReactHack] Script inyectado exitosamente en el mundo principal.');
  
  document.addEventListener('PartyHazz_DoSeek', (e) => {
    const time = e.detail;
    const slider = document.querySelector('.timeline-slider');
    let reactTriggereado = false;
    
    console.log('[PartyHazz-ReactHack] Intentando hack de React para t=', time);
    if (slider) {
      const propsKey = Object.keys(slider).find(key => key.startsWith('__reactProps$'));
      if (propsKey && slider[propsKey]) {
        const props = slider[propsKey];
        const fakeEvent = { 
          target: { value: time.toString() }, 
          currentTarget: { value: time.toString() }, 
          preventDefault: () => {}, 
          stopPropagation: () => {} 
        };
        
        console.log('[PartyHazz-ReactHack] Propiedades de React disponibles en el slider:', Object.keys(props));
        
        // Fase 1: Actualizar el valor visual (Scrub)
        if (props.onChange) { 
          props.onChange(fakeEvent); 
          reactTriggereado = true; 
          console.log('[PartyHazz-ReactHack] onChange disparado'); 
        } else if (props.onInput) { 
          props.onInput(fakeEvent); 
          reactTriggereado = true; 
          console.log('[PartyHazz-ReactHack] onInput disparado'); 
        }
        
        // Fase 2: Confirmar el salto (Commit)
        const eventosCommit = ['onChangeCommitted', 'onMouseUp', 'onPointerUp', 'onTouchEnd', 'onSeek', 'onSlidingComplete', 'onDragEnd'];
        for (let evtName of eventosCommit) {
           if (props[evtName]) {
              console.log('[PartyHazz-ReactHack] Disparando evento de confirmación:', evtName);
              props[evtName](fakeEvent);
           }
        }
      } else {
        console.warn('[PartyHazz-ReactHack] No se encontró __reactProps$ en el slider');
      }
    } else {
      console.warn('[PartyHazz-ReactHack] No se encontró .timeline-slider');
    }
    
    if (!reactTriggereado) {
      console.error('[PartyHazz-ReactHack] FALLÓ EL HACK. Cayendo al nativo.');
      const v = document.querySelector('video');
      if (v) v.currentTime = time;
    } else {
      console.log('[PartyHazz-ReactHack] Éxito');
    }
  });
})();
