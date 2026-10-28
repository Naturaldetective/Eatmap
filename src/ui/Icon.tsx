import type { SVGProps } from 'react';

/**
 * 细线图标集。可爱来自「圆头线条 + 略圆的转角」（strokeLinecap/join = round），
 * 不来自 emoji——emoji 跨平台渲染不一致，且是界面廉价感的第一来源。
 * 统一 24 格画布、1.7 描边，尺寸由调用方用 className 控制。
 */
const PATHS = {
  map: (
    <>
      <path d="M9 4 3.5 6.2v13.6L9 17.6l6 2.2 5.5-2.2V4L15 6.2 9 4Z" />
      <path d="M9 4v13.6M15 6.2v13.6" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5 6.6 5.4A1.6 1.6 0 0 1 8.1 4.3h7.8a1.6 1.6 0 0 1 1.5 1.1L20 13.5V18a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18v-4.5Z" />
      <path d="M4 13.5h4.2l1 2.2h5.6l1-2.2H20" />
    </>
  ),
  ranking: <path d="M5.5 20v-6.5M12 20V5.5M18.5 20v-10.5" />,
  data: (
    <>
      <path d="M12 3.6 3.4 8 12 12.4 20.6 8 12 3.6Z" />
      <path d="M3.4 12.4 12 16.8l8.6-4.4M3.4 16.6 12 21l8.6-4.4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="M15.6 15.8 20.2 20.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.6 12a7.6 7.6 0 1 1-2.24-5.37" />
      <path d="M19.9 4.2v4.2h-4.2" />
    </>
  ),
  close: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  external: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M18 14.5v4.2c0 .9-.7 1.6-1.6 1.6H5.8c-.9 0-1.6-.7-1.6-1.6V8.1c0-.9.7-1.6 1.6-1.6h4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 7.2h14.4M9.5 7.2V5.6c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1v1.6" />
      <path d="M6.4 7.2 7.3 19c0 .7.6 1.2 1.3 1.2h6.8c.7 0 1.3-.5 1.3-1.2l.9-11.8" />
      <path d="M10.2 11v5.6M13.8 11v5.6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.8v10.4m0 0 3.8-3.8M12 14.2l-3.8-3.8" />
      <path d="M4.5 15.5v3c0 .9.7 1.6 1.6 1.6h11.8c.9 0 1.6-.7 1.6-1.6v-3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14.6V4.2m0 0L8.2 8M12 4.2 15.8 8" />
      <path d="M4.5 15.5v3c0 .9.7 1.6 1.6 1.6h11.8c.9 0 1.6-.7 1.6-1.6v-3" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  pin: (
    <>
      <path d="M12 20.5s6.2-5.7 6.2-10.2a6.2 6.2 0 1 0-12.4 0C5.8 14.8 12 20.5 12 20.5Z" />
      <circle cx="12" cy="10.2" r="2.3" />
    </>
  ),
  tag: (
    <>
      <path d="M4.5 11.3V5.4c0-.5.4-.9.9-.9h5.9c.2 0 .5.1.6.3l7.3 7.3a.9.9 0 0 1 0 1.3l-5.9 5.9a.9.9 0 0 1-1.3 0L4.8 11.9a.9.9 0 0 1-.3-.6Z" />
      <circle cx="8.4" cy="8.4" r="1.1" />
    </>
  ),
  bowl: (
    <>
      <path d="M4.2 12.2h15.6c0 4.3-3.5 7.8-7.8 7.8s-7.8-3.5-7.8-7.8Z" />
      <path d="M9 9.4c0-1.3.9-1.7.9-2.9M12.4 9.4c0-1.3.9-1.7.9-2.9M15.8 9.4c0-1.3.9-1.7.9-2.9" />
    </>
  ),
  mountain: (
    <>
      <path d="M3 18.5h18L14.8 8.2l-3.3 5.1-2.2-2.6L3 18.5Z" />
      <circle cx="17.4" cy="5.4" r="1.9" />
    </>
  ),
  check: <path d="M5 12.6 9.6 17.2 19 7.8" />,
  alert: (
    <>
      <path d="M12 4.4 2.9 20h18.2L12 4.4Z" />
      <path d="M12 10.2v4.2M12 17.2h.01" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
}

export default function Icon({ name, className = 'h-4 w-4', ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
