import type {Metadata} from 'next';
import './globals.css';
import './themes.css';
import {ThemeProvider} from './components/ThemeControls';
export const metadata:Metadata={title:'Forgeboard — Your creative command center',description:'Connected knowledge, shared tasks, and visual planning for game development teams.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" data-theme="current" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('forgeboard-appearance');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'current'}catch(e){}"}}/></head><body><ThemeProvider>{children}</ThemeProvider></body></html>}
