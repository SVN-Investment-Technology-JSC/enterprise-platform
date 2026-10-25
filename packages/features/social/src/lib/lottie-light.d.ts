// Bản lottie-web nhẹ (chỉ renderer SVG) không kèm kiểu riêng; dùng lại kiểu của gói chính.
declare module 'lottie-web/build/player/lottie_light' {
  const lottie: typeof import('lottie-web').default;
  export default lottie;
}
