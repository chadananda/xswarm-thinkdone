// Shared audio module — howler.js sprites for UI sound effects
// Sounds: applause (task complete), click (uncheck), drop (reorder/add), poof (delete)
import { Howl } from 'howler';

let sounds = null;

function getSounds() {
  if (sounds) return sounds;
  sounds = {
    applause: new Howl({ src: ['/audio/applause.wav'], volume: 0.5 }),
    click: new Howl({ src: ['/audio/click.wav'], volume: 0.6 }),
    drop: new Howl({ src: ['/audio/drop.wav'], volume: 0.5 }),
    poof: new Howl({ src: ['/audio/poof.wav'], volume: 0.6 }),
  };
  return sounds;
}

export function playApplause() { getSounds().applause.play(); }
export function playClick() { getSounds().click.play(); }
export function playDrop() { getSounds().drop.play(); }
export function playPoof() { getSounds().poof.play(); }
