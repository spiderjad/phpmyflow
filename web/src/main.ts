import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';
import { applyAppearance, mirroredAppearance } from './lib/theme';

// The inline script in index.html already set the attributes; this adds the
// accent hover and keeps "system" following the OS.
applyAppearance(mirroredAppearance());

export default mount(App, { target: document.getElementById('app')! });
