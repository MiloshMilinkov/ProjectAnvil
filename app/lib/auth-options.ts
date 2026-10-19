import { username } from 'better-auth/plugins/username';
import type { BetterAuthOptions } from 'better-auth';

export function authOptions(database: NonNullable<BetterAuthOptions['database']>, secret: string, baseURL: string): BetterAuthOptions {
  return {
    appName:'ProjectAnvil', database, secret, baseURL,
    trustedOrigins:[baseURL], telemetry:{enabled:false},
    emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:false},
    plugins:[username({minUsernameLength:3,maxUsernameLength:30,immutableUsername:true,displayUsername:false,usernameValidator:value=>/^[a-zA-Z0-9_.]{3,30}$/.test(value)})],
    session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
    advanced:{cookiePrefix:'projectanvil',defaultCookieAttributes:{httpOnly:true,sameSite:'lax'}},
    rateLimit:{enabled:true,storage:'database',window:60,max:60,customRules:{'/sign-in/username':{window:60,max:10},'/sign-up/email':{window:60,max:5}}},
  };
}
