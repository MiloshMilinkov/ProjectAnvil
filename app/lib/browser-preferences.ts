// Preserve existing browser settings when the app's name changes.
export function readBrowserPreference(key:string):string|null {
 try {
  const current=localStorage.getItem(key);
  if(current!==null)return current;
  if(!key.startsWith('projectanvil'))return null;
  const previous=localStorage.getItem('forgeboard'+key.slice('projectanvil'.length));
  if(previous!==null)localStorage.setItem(key,previous);
  return previous;
 }catch{return null;}
}
