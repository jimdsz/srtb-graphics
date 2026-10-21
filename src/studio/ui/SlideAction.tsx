import type {ButtonHTMLAttributes, ReactNode} from 'react';

/** Adapted from Kokonut UI's MIT Slide Text Button. See THIRD-PARTY-NOTICES.md.
 * Native button + local CSS keep the studio independent of Next/Tailwind.
 * Both visual labels are identical so hovering never changes the action. */
export default function SlideAction({children,icon,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:ReactNode}){
  return <button {...props} className={`slide-action ${className}`}><span className="slide-action-window"><span className="slide-action-track"><span>{children}</span><span aria-hidden="true">{children}</span></span></span>{icon}</button>;
}
