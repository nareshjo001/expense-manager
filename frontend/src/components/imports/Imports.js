import TrendChartPage from '../charts/linechart/TrendChartPage';
import BarChartPage from '../charts/barchart/BarChartPage';
import PieChartPage from '../charts/piechart/PieChartPage';
import ExpensesPage from '../expensesHandling/ExpensesPage';
import AddExpense from '../expensesHandling/AddExpense';
import DeleteAlert from '../alertsEffects/DeleteAlert';
import SplashScreen from '../landingPage/SplashScreen';
import ScrollToTopButton from '../alertsEffects/ScrollToTopButton';
import  { BudgetProvider }  from '../contexts/BudgetContext';
import { ThemeContext } from '../contexts/ThemeContext';
import { BudgetContext } from '../contexts/BudgetContext';
import Insights from '../monthlyInsights/Insights';
import { deleteSuccessToast, deleteErrorToast } from '../alertsEffects/toastMessages';
import Add from '../expensesHandling/Add';

export { 
    BudgetProvider,
    ThemeContext,
    BudgetContext,
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
    Add
};
