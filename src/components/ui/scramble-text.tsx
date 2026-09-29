import { useEffect, useRef, useState } from 'react';

const scrambleCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function ScrambleText({ text, className }: { text: string; className?: string }) {
  const [displayText, setDisplayText] = useState(text);
  const previousText = useRef(text);

  useEffect(() => {
    if (text === previousText.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { previousText.current = text; setDisplayText(text); return; }
    previousText.current = text;

    const characters = Array.from(text);
    const frames = 10;
    let frame = 0;
    const reveal = () => {
      const revealCount = Math.ceil(characters.length * frame / frames);
      setDisplayText(characters.map((character, index) => {
        if (index < revealCount || !/[\p{L}\p{N}]/u.test(character)) return character;
        return scrambleCharacters[Math.floor(Math.random() * scrambleCharacters.length)];
      }).join(''));
    };
    reveal();
    const interval = window.setInterval(() => {
      frame += 1;
      reveal();
      if (frame >= frames) window.clearInterval(interval);
    }, 28);
    return () => window.clearInterval(interval);
  }, [text]);

  return <span className={className}><span className="sr-only" aria-live="polite" aria-atomic="true">{text}</span><span aria-hidden="true">{displayText}</span></span>;
}
