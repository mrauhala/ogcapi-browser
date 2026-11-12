import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme } from '@mui/material/styles';
import NameToggles, { AxisToggles } from './NameToggles';
import { words } from '../coverage/cellsTestData';

const render = (value: string, extra: { marked?: string; tall?: boolean } = {}) => renderToStaticMarkup(
  <NameToggles label="f" options={['CoverageJSON', 'GeoJSON', 'PNG']} value={value} onChange={() => {}} {...extra} />,
);
const count = (html: string, text: string) => html.split(text).length - 1;
// Each button's pressed state, in order
const pressed = (html: string) => html.split('<button').slice(1).map(button => button.includes('aria-pressed="true"'));

describe('NameToggles', () => {
  it('shows the names to choose from, with none pressed to start', () => {
    const html = render('');
    expect(words(html)).toBe('CoverageJSON GeoJSON PNG');
    expect(pressed(html)).toEqual([false, false, false]);
    expect(html).toContain('aria-label="f"');
  });

  it('presses the one chosen', () => {
    expect(pressed(render('GeoJSON'))).toEqual([false, true, false]);
  });

  it('adds a value not listed, as from a link, pressed, so it’s seen and can be taken back', () => {
    const html = render('PNGX');
    expect(words(html)).toBe('CoverageJSON GeoJSON PNG PNGX');
    expect(pressed(html)).toEqual([false, false, false, true]);
  });

  it('tags the default the metadata names, without pressing it', () => {
    expect(words(render('', { marked: 'CoverageJSON' }))).toBe('CoverageJSON default GeoJSON PNG');
    expect(pressed(render('', { marked: 'CoverageJSON' }))).toEqual([false, false, false]);
    expect(pressed(render('CoverageJSON', { marked: 'CoverageJSON' }))).toEqual([true, false, false]);
    expect(count(words(render('', { marked: 'NetCDF' })), 'default')).toBe(0);
  });

  it('shows an option by its label where it has one, its value as it is', () => {
    const html = renderToStaticMarkup(<NameToggles label="reference_time" options={['*', '2026-11-12T00:00:00Z']} value="*" onChange={() => {}} labels={{ '*': 'Latest' }} />);
    expect(words(html)).toBe('Latest 2026-11-12T00:00:00Z');
    expect(html).toContain('value="*"');
    expect(pressed(html)).toEqual([true, false]);
  });

  it('as axes, presses each the value has, and hears which one is pressed or let go', () => {
    const toggled: string[] = [];
    const element = AxisToggles({ label: 'subset axes', options: ['Lon', 'Lat', 'time'], pressed: ['Lat', 'vertical'], onToggle: axis => toggled.push(axis) }) as ReactElement<{ onChange: (event: unknown, next: string[]) => void }>;
    const html = renderToStaticMarkup(element);
    expect(words(html)).toBe('Lon Lat time');
    expect(pressed(html)).toEqual([false, true, false]);
    element.props.onChange(null, ['Lat', 'vertical', 'time']);
    element.props.onChange(null, ['vertical']);
    element.props.onChange(null, ['Lat', 'vertical']);
    expect(toggled).toEqual(['time', 'Lat']);
  });

  it('stands as tall as the number beside it, as a unit does', () => {
    expect(render('', { tall: true })).toContain('height:40px');
    expect(render('')).not.toContain('height:40px');
  });

  it('shows in orange an option the request has though the metadata doesn’t back it, pressed as chosen', () => {
    const html = renderToStaticMarkup(<NameToggles label="style" options={['default', 'fmi-hires']} value="fmi-hires" onChange={() => {}} warned="fmi-hires" />);
    expect(words(html)).toBe('default fmi-hires');
    expect(pressed(html)).toEqual([false, true]);
    const plain = renderToStaticMarkup(<NameToggles label="style" options={['default', 'fmi-hires']} value="fmi-hires" onChange={() => {}} />);
    // The orange of a value not listed, in the CSS written for the warned one
    const orange = createTheme().palette.warning.main;
    expect(count(html, orange)).toBeGreaterThan(0);
    expect(count(plain, orange)).toBe(0);
  });
});
