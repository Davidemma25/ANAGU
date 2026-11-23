import { Wallet } from 'lucide-react';

export function WalletBrandIcon({ walletType = 'auto', className = 'w-4 h-4' }) {
  if (walletType === 'trustwallet') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        <path
          d="M12 2.5L4.5 5.8v5.6c0 4.9 3.2 9.4 7.5 10.6 4.3-1.2 7.5-5.7 7.5-10.6V5.8L12 2.5z"
          fill="#0500FF"
          stroke="#0500FF"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M12 5.3L7 7.5v3.9c0 3.4 2.1 6.5 5 7.5 2.9-1 5-4.1 5-7.5V7.5l-5-2.2z"
          fill="#FFFFFF"
        />
        <path
          d="M12 6.8L8.4 8.4v2.9c0 2.5 1.5 4.8 3.6 5.6 2.1-.8 3.6-3.1 3.6-5.6V8.4L12 6.8z"
          fill="#0500FF"
        />
      </svg>
    );
  }

  if (walletType === 'metamask') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        <path d="M20.6 3.5L13.5 8.8l1.3-3.1 5.8-2.2z" fill="#E17726" />
        <path d="M3.4 3.5l7 5.4-1.2-3.2L3.4 3.5z" fill="#E27625" />
        <path d="M18 16.5l-1.9 2.9 4 1.1 1.1-3.9-3.2-.1z" fill="#E27625" />
        <path d="M2.8 16.6l1.1 3.9 4-1.1L6 16.5l-3.2.1z" fill="#E27625" />
        <path d="M7.7 10.6l-1.1 1.7 4 .2-.1-4.3-2.8 2.4z" fill="#E27625" />
        <path d="M16.3 10.6l-2.8-2.5-.1 4.4 4-.2-1.1-1.7z" fill="#E27625" />
        <path d="M7.9 19.4l2.4-1.2-2.1-1.6-.3 2.8z" fill="#E27625" />
        <path d="M13.7 18.2l2.4 1.2-.3-2.8-2.1 1.6z" fill="#E27625" />
        <path d="M10.3 14.5l-.6 2.5 2.3.7 2.3-.7-.6-2.5H10.3z" fill="#F5841F" />
      </svg>
    );
  }

  return <Wallet className={className} aria-hidden="true" />;
}
