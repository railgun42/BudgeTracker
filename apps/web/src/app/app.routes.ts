import { Routes } from '@angular/router';
import { HomePage } from './pages/home-page/home-page';
import { LoginPage } from './pages/login-page/login-page';
import { SignUpPage } from './pages/sign-up-page/sign-up-page';

export const routes: Routes = [
    { 
        path: '', 
        component: HomePage
    },
    { 
        path: 'login', 
        component: LoginPage
    },
    { 
        path: 'signup', 
        component: SignUpPage 
    }
    /*






    { 
        path: '404', 
        component: Page404 
    },*/
];