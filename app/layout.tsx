import type {Metadata} from 'next';
import './globals.css';
import './themes.css';
import './readability.css';
import {ThemeProvider} from './components/ThemeControls';
export const metadata:Metadata={title:'ProjectAnvil — Your projects, connected',description:'Connected projects, tasks, notes, and everyday planning.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" data-theme="current" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{var t=(localStorage.getItem('projectanvil-appearance')??localStorage.getItem('forgeboard-appearance'));document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'current'}catch(e){}"}}/></head><body><ThemeProvider>{children}</ThemeProvider></body></html>}
