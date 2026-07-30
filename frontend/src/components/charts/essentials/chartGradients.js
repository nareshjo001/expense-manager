import React from 'react';

// SVG gradient <defs> sets shared by chart wrappers for light and dark themes.
export const LightThemeGradients = () => (
  <defs>
    <radialGradient id="lt-pink-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fca5a5" />
      <stop offset="100%" stopColor="#f87171" />
    </radialGradient>

    <radialGradient id="lt-light-blue-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#93c5fd" />
      <stop offset="100%" stopColor="#60a5fa" />
    </radialGradient>

    <radialGradient id="lt-purple-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#c4b5fd" />
      <stop offset="100%" stopColor="#a78bfa" />
    </radialGradient>

    <radialGradient id="lt-yellow-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fde68a" />
      <stop offset="100%" stopColor="#facc15" />
    </radialGradient>

    <radialGradient id="lt-cyan-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#67e8f9" />
      <stop offset="100%" stopColor="#22d3ee" />
    </radialGradient>

    <radialGradient id="lt-green-highlight" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#bbf7d0" />
      <stop offset="100%" stopColor="#a3e635" />
    </radialGradient>

    <radialGradient id="lt-orange-highlight" fx="30%" fy="30%">
        <stop offset="0%" stopColor="#fdba74" />
        <stop offset="100%" stopColor="#fb923c" />
    </radialGradient>

        <radialGradient id="lt-red-highlight" fx="30%" fy="30%">
        <stop offset="0%" stopColor="#fca5a5" />
        <stop offset="100%" stopColor="#ef4444" />
    </radialGradient>

    <radialGradient id="lt-gray-highlight" fx="30%" fy="30%">
        <stop offset="0%" stopColor="#d1d5db" />
        <stop offset="100%" stopColor="#9ca3af" />
    </radialGradient>

    <radialGradient id="lt-magenta-highlight" fx="30%" fy="30%">
        <stop offset="0%" stopColor="#fbcfe8" />
        <stop offset="100%" stopColor="#ec4899" />
    </radialGradient>
  </defs>
);

export const DarkThemeGradients = () => (
  <defs>
    <radialGradient id="dk-blue-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#e0f2fe" />
      <stop offset="15%" stopColor="#60a5fa" />
      <stop offset="40%" stopColor="#3b82f6" />
      <stop offset="100%" stopColor="#1e3a8a" />
    </radialGradient>

    <radialGradient id="dk-orange-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fff7ed" />
      <stop offset="15%" stopColor="#fb923c" />
      <stop offset="40%" stopColor="#f97316" />
      <stop offset="100%" stopColor="#b45309" />
    </radialGradient>

    <radialGradient id="dk-green-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#ecfdf5" />
      <stop offset="15%" stopColor="#34d399" />
      <stop offset="40%" stopColor="#10b981" />
      <stop offset="100%" stopColor="#166534" />
    </radialGradient>

    <radialGradient id="dk-yellow-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fefce8" />
      <stop offset="15%" stopColor="#fde047" />
      <stop offset="40%" stopColor="#facc15" />
      <stop offset="100%" stopColor="#a16207" />
    </radialGradient>

    <radialGradient id="dk-purple-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#f5f3ff" />
      <stop offset="15%" stopColor="#c4b5fd" />
      <stop offset="40%" stopColor="#8b5cf6" />
      <stop offset="100%" stopColor="#5b21b6" />
    </radialGradient>

    <radialGradient id="dk-pink-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fdf2f8" />
      <stop offset="15%" stopColor="#f472b6" />
      <stop offset="40%" stopColor="#ec4899" />
      <stop offset="100%" stopColor="#831843" />
    </radialGradient>

    <radialGradient id="dk-red-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fee2e2" />
      <stop offset="15%" stopColor="#ef4444" />
      <stop offset="40%" stopColor="#dc2626" />
      <stop offset="100%" stopColor="#7f1d1d" />
    </radialGradient>

    <radialGradient id="dk-cyan-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#e0fbfc" />
      <stop offset="15%" stopColor="#22d3ee" />
      <stop offset="40%" stopColor="#06b6d4" />
      <stop offset="100%" stopColor="#164e63" />
    </radialGradient>

    <radialGradient id="dk-magenta-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#fdf2f8" />
      <stop offset="15%" stopColor="#db2777" />
      <stop offset="40%" stopColor="#be185d" />
      <stop offset="100%" stopColor="#500724" />
    </radialGradient>

    <radialGradient id="dk-gray-glow" fx="30%" fy="30%">
      <stop offset="0%" stopColor="#f3f4f6" />
      <stop offset="15%" stopColor="#9ca3af" />
      <stop offset="40%" stopColor="#4b5563" />
      <stop offset="100%" stopColor="#1f2937" />
    </radialGradient>
  </defs>
);