import React, { createContext, useState, useEffect } from 'react';

// Global theme context to allow light/dark toggle across app
export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'light-theme';
    });

    const toggleTheme = () => {
        setTheme(prevTheme => prevTheme === 'light-theme' ? 'dark-theme' : 'light-theme');
    };

    useEffect(() => {
        localStorage.setItem('theme', theme);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};