import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Forgeboard — Your creative command center',description:'Connected knowledge, shared tasks, and visual planning for game development teams.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
