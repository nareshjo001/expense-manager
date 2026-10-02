import { useState, useEffect } from 'react';
import './ScrollToTopButton.css';

// Shows a button that scrolls smoothly to the top once the page is scrolled down 300px.
export default function ScrollToTopButton() {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const checkScrollTop = () => {
      const isHiddenPage = Boolean(
        document.querySelector('.notification-prefs-page')
      );
      setShowButton(!isHiddenPage && window.scrollY > 300);
    };

    window.addEventListener('scroll', checkScrollTop);
    window.addEventListener('popstate', checkScrollTop);

    return () => {
      window.removeEventListener('scroll', checkScrollTop);
      window.removeEventListener('popstate', checkScrollTop);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return showButton ? (
    <button
      className="scroll-top-btn"
      onClick={scrollToTop}
      style={{ zIndex: 99999 }}
    >
      ↑ Top
    </button>
  ) : null;
}