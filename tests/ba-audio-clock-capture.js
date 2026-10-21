// Same-origin worklet for the local qualification page. Never part of production.
class Capture extends AudioWorkletProcessor {
  constructor(){
    super();this.count=0;this.first=0;this.channels=[new Float32Array(2048),new Float32Array(2048)];this.live=true;this.armed=false;this.nextFrame=null;
    this.port.onmessage=event=>{if(event.data.type==='arm'){this.armed=true;this.count=0;this.nextFrame=null;this.port.postMessage({type:'armed',id:event.data.id});}if(event.data.type==='flush'){this.flush();this.port.postMessage({type:'flushed',id:event.data.id});}if(event.data.type==='stop')this.live=false;};
  }
  flush(){
    if(!this.count)return;const channels=this.channels.map(channel=>channel.slice(0,this.count));
    this.port.postMessage({type:'chunk',firstFrame:this.first,channels},channels.map(channel=>channel.buffer));this.count=0;
  }
  process(inputs,outputs){
    if(!this.live)return false;const output=outputs[0];for(const channel of output)channel.fill(0);
    if(!this.armed)return true;
    const input=inputs[0],length=output[0].length;
    if(this.nextFrame!==null&&currentFrame!==this.nextFrame){
      // Preserve the exact origin of each contiguous block. Never splice PCM
      // across a clock jump: the consumer must reject or diagnose the gap.
      this.flush();
      this.port.postMessage({type:'gap',expectedFrame:this.nextFrame,receivedFrame:currentFrame,delta:currentFrame-this.nextFrame});
    }
    this.nextFrame=currentFrame+length;
    for(let frame=0;frame<length;frame++){
      if(!this.count)this.first=currentFrame+frame;
      for(let channel=0;channel<2;channel++)this.channels[channel][this.count]=input[channel]?.[frame]||0;
      this.count++;if(this.count===2048)this.flush();
    }
    return true;
  }
}
registerProcessor('ba-qualification-capture',Capture);
