import React from 'react';
import './SplashScreen.css'; 

const SplashScreen = () => {
  return (
    <div className="splash-screen">
        <div className="stage">
            {Array.from({ length: 20 }).map((_, i) => (
            <div className="layer" key={i} data-text={"Balensia"}></div>
            ))}
        </div>
    </div>
    );
};

export default SplashScreen;