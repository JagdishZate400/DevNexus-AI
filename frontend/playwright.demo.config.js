import config from './playwright.config.js'
export default { ...config, reporter: 'list', projects: [{ name: 'chrome', use: { ...config.projects[0].use, channel: 'chrome' } }] }
