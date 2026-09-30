import { Routes } from '@angular/router';

export const routes: Routes = [
    { 
        path: '', 
        component: Home
    },
    { 
        path: 'login', 
        component: LoginPage
    },
    { 
        path: 'signup', 
        component: SignUpPage 
    },






    { 
        path: '404', 
        component: Page404 
    },
];