import TrendChartPage from '../charts/linechart/TrendChartPage';
import BarChartPage from '../charts/barchart/BarChartPage';
import PieChartPage from '../charts/piechart/PieChartPage';
import ExpensesPage from '../expensesHandling/ExpensesPage';
import AddExpense from '../expensesHandling/AddExpense';
import DeleteAlert from '../alertsEffects/DeleteAlert';
import SplashScreen from '../landingPage/SplashScreen';
import ScrollToTopButton from '../alertsEffects/ScrollToTopButton';
import { ThemeContext } from '../contexts/ThemeContext';
import Insights from '../monthlyInsights/Insights';
import { deleteSuccessToast, deleteErrorToast } from '../alertsEffects/toastMessages';
import Add from '../expensesHandling/Add';
import Spinner from '../alertsEffects/Spinner';
import MerchantRules from '../merchantRules/MerchantRules';

// Barrel re-export of top-level page/context/util modules used across the app.
export {
    ThemeContext,
    TrendChartPage,
    BarChartPage, 
    PieChartPage, 
    ExpensesPage, 
    AddExpense, 
    DeleteAlert, 
    SplashScreen,
    ScrollToTopButton ,
    Insights,
    deleteSuccessToast,
    deleteErrorToast,
    Add,
    Spinner,
    MerchantRules
};
