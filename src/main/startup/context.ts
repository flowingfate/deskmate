export const IS_DEV = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
export const IS_EVAL = process.argv.includes('--eval-mode');