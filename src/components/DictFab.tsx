"use client";
import Image from "next/image";

interface DictFabProps { onClick: () => void; }

export default function DictFab({ onClick }: DictFabProps) {
  return (
    <button id="dict-fab" className="dict-fab" title="Tra từ điển" aria-label="Tra từ điển" onClick={onClick}>
      <Image src="/svg/icon.svg" alt="Dict icon" width={28} height={28} />
    </button>
  );
}
