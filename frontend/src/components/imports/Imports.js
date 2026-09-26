import ExpensesPage from '../expensesHandling/ExpensesPage';
import AddExpense from '../expensesHandling/AddExpense';
import DeleteAlert from '../alertsEffects/DeleteAlert';
import SplashScreen from '../landingPage/SplashScreen';
import ScrollToTopButton from '../alertsEffects/ScrollToTopButton';
import { ThemeContext } from '../contexts/ThemeContext';
import { deleteSuccessToast, deleteErrorToast } from '../alertsEffects/toastMessages';
import Add from '../expensesHandling/Add';
import Spinner from '../alertsEffects/Spinner';
import MerchantRules from '../merchantRules/MerchantRules';
import RecurringPage from '../recurring/RecurringPage';
import NotificationPreferences from '../notifications/NotificationPreferences';
import DataExport from '../dataExport/DataExport';
import ReceiptInbox from '../receiptInbox/ReceiptInbox';
import ImportWizard from '../importWizard/ImportWizard';
import SiaPreferences from '../sia/SiaPreferences';

// FE-003-T01 -- TrendChartPage/BarChartPage/PieChartPage/Insights removed from
// this barrel: FE-003-T03 moved every real consumer (App.js, LandingPage.js) off
// these barrel exports onto their own React.lazy()/import() call sites so webpack
// could split them into separate chunks -- confirmed by static analysis
// (scripts/analyzeBundleComposition.js) that no file in src/ still imports these
// four names from this barrel. Leaving the barrel's own eager imports of them in
// place was pure dead code, and dead code webpack has to prove is dead before it
// can be tree-shaken out is exactly the kind of ambiguity a real production build
// (FE-003-T07) would be needed to resolve either way -- removing the dead imports
// outright removes the ambiguity instead, regardless of what tree-shaking does.
// Barrel re-export of top-level page/context/util modules used across the app.
export {
    ThemeContext,
    ExpensesPage,
    AddExpense,
    DeleteAlert,
    SplashScreen,
    ScrollToTopButton ,
    deleteSuccessToast,
    deleteErrorToast,
    Add,
    Spinner,
    MerchantRules,
    RecurringPage,
    NotificationPreferences,
    DataExport,
    ReceiptInbox,
    ImportWizard,
    SiaPreferences
};
