import { Routes } from '@angular/router';
import { HomePage } from './pages/home-page/home-page';
import { LoginPage } from './pages/login-page/login-page';
import { SignUpPage } from './pages/sign-up-page/sign-up-page';
import { Page404 } from './pages/page404/page404';
import { HistoryPage } from './pages/history-page/history-page';
import { AuthGuard } from './guards/auth-guard';
import { AccountsPage } from './pages/accounts-page/accounts-page';
import { NewTransactionPage } from './pages/new-transaction-page/new-transaction-page';

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
    },
    {
        path: 'history',
        component: HistoryPage,
        canActivate: [AuthGuard]
    },
    {
        path: 'accounts',
        component: AccountsPage,
        canActivate: [AuthGuard]
    },
    {
        path: 'new-transaction',
        component: NewTransactionPage,
        canActivate: [AuthGuard]
    },







    { 
        path: '**', 
        component: Page404
    }
];