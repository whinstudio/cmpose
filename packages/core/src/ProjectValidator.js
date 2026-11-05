/**
 * ProjectValidator - Shared validation logic for both frontend and backend
 * UMD (Universal Module Definition) format for browser and Node.js compatibility
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        // Node.js / CommonJS
        module.exports = factory();
    } else {
        // Browser global
        root.ProjectValidator = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Default Constants (can be overridden via configure())
    let MAX_MODULES = 3;
    let MIN_SDK_MIN = 24;
    let MIN_SDK_MAX = 36;
    let IOS_VERSION_MIN = '15.0';
    let IOS_VERSION_MAX = '26.2';
    // Package reserved by the template itself (e.g. its own package); none by default
    let RESERVED_PACKAGE_PREFIX = null;

    // Max lengths for input fields
    const MAX_LENGTH_PROJECT_NAME = 30;
    const MAX_LENGTH_APP_NAME = 30;
    const MAX_LENGTH_PACKAGE_NAME = 50;
    const MAX_LENGTH_MODULE_NAME = 20;
    const MAX_LENGTH_BASE_URL = 100;

    // Format regexes: the one place they live (validators below use them; contract.js publishes their sources)
    const PATTERNS = {
        projectName: /^[a-zA-Z]+$/,
        packageName: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/,
        moduleName: /^[a-z][a-z0-9]*$/,
        iosVersionFormat: /^\d+(\.\d+){1,2}$/
    };

    // Kotlin hard keywords - cannot be used as package segments or module names
    const KOTLIN_HARD_KEYWORDS = ['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while'];

    // Java reserved words and literals - AGP refuses a namespace with one as a segment
    // (e.g. com.acme.new), and module names become package segments too
    const JAVA_KEYWORDS = ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null'];

    function isKeyword(word) {
        return KOTLIN_HARD_KEYWORDS.indexOf(word) !== -1 || JAVA_KEYWORDS.indexOf(word) !== -1;
    }

    // Module names the generator cannot use: file processing skips every directory named build
    // (Gradle output), so feature/build would keep the template package; monetization is the
    // template's own feature/monetization module (purchases/ads flags); notes is blank's Room demo
    // (feature/notes); account and sharing are the backend flag's feature/account and feature/sharing
    const RESERVED_MODULE_NAMES = ['build', 'monetization', 'notes', 'account', 'sharing'];

    /**
     * Compare two version strings (e.g., '15.0' vs '15.0.1')
     * @returns {number} - -1 if a < b, 0 if a == b, 1 if a > b
     */
    function compareVersions(a, b) {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        const len = Math.max(partsA.length, partsB.length);
        for (let i = 0; i < len; i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA < numB) return -1;
            if (numA > numB) return 1;
        }
        return 0;
    }

    const ProjectValidator = {
        /**
         * Maximum number of feature modules allowed
         */
        MAX_MODULES: MAX_MODULES,

        /**
         * Configure validation limits (call this on server startup or page load)
         * @param {Object} config - Configuration object
         */
        configure: function (config) {
            if (config.maxModules !== undefined) MAX_MODULES = config.maxModules;
            if (config.minSdkMin !== undefined) MIN_SDK_MIN = config.minSdkMin;
            if (config.minSdkMax !== undefined) MIN_SDK_MAX = config.minSdkMax;
            if (config.iosVersionMin !== undefined) IOS_VERSION_MIN = config.iosVersionMin;
            if (config.iosVersionMax !== undefined) IOS_VERSION_MAX = config.iosVersionMax;
            if (config.reservedPackagePrefix !== undefined) RESERVED_PACKAGE_PREFIX = config.reservedPackagePrefix;
            // Update exposed constants
            this.MAX_MODULES = MAX_MODULES;
            this.MIN_SDK_MIN = MIN_SDK_MIN;
            this.MIN_SDK_MAX = MIN_SDK_MAX;
            this.IOS_VERSION_MIN = IOS_VERSION_MIN;
            this.IOS_VERSION_MAX = IOS_VERSION_MAX;
            // Update dynamic messages
            this.messages.maxModulesReached = 'Maximum ' + MAX_MODULES + ' feature modules allowed';
            this.messages.minSdkInvalid = 'Min SDK must be a number between ' + MIN_SDK_MIN + ' and ' + MIN_SDK_MAX;
            this.messages.iosVersionInvalid = 'iOS Version must be between ' + IOS_VERSION_MIN + ' and ' + IOS_VERSION_MAX;
        },

        /**
         * Get current configuration values
         * @returns {Object} - Current config values
         */
        getConfig: function () {
            return {
                maxModules: MAX_MODULES,
                minSdkMin: MIN_SDK_MIN,
                minSdkMax: MIN_SDK_MAX,
                iosVersionMin: IOS_VERSION_MIN,
                iosVersionMax: IOS_VERSION_MAX,
                reservedPackagePrefix: RESERVED_PACKAGE_PREFIX
            };
        },

        /**
         * Exposed config values
         */
        MIN_SDK_MIN: MIN_SDK_MIN,
        MIN_SDK_MAX: MIN_SDK_MAX,
        IOS_VERSION_MIN: IOS_VERSION_MIN,
        IOS_VERSION_MAX: IOS_VERSION_MAX,

        /**
         * Max lengths for input fields
         */
        MAX_LENGTH_PROJECT_NAME: MAX_LENGTH_PROJECT_NAME,   // Project name
        MAX_LENGTH_APP_NAME: MAX_LENGTH_APP_NAME,           // App name (user visible)
        MAX_LENGTH_PACKAGE_NAME: MAX_LENGTH_PACKAGE_NAME,   // Package name (e.g., com.company.app.module)
        MAX_LENGTH_MODULE_NAME: MAX_LENGTH_MODULE_NAME,     // Feature module name
        MAX_LENGTH_MIN_SDK: 2,          // Max 2 digits (e.g., 36)
        MAX_LENGTH_IOS_VERSION: 8,      // Max format: xx.xx.xx (e.g., 26.2.1)
        MAX_LENGTH_BASE_URL: MAX_LENGTH_BASE_URL,           // Network base URL

        /**
         * Format regexes and name lists (read-only; contract.js publishes them)
         */
        patterns: PATTERNS,
        KOTLIN_HARD_KEYWORDS: KOTLIN_HARD_KEYWORDS,
        JAVA_KEYWORDS: JAVA_KEYWORDS,
        RESERVED_MODULE_NAMES: RESERVED_MODULE_NAMES,

        /**
         * Validates that the value is a string no longer than max characters
         * @param {string} value - The value to validate
         * @param {number} max - Maximum allowed length (inclusive)
         * @returns {boolean} - True if valid
         */
        validateMaxLength: function (value, max) {
            return typeof value === 'string' && value.length <= max;
        },

        /**
         * Validates that the value contains no spaces
         * @param {string} value - The value to validate
         * @returns {boolean} - True if valid (no spaces)
         */
        validateNoSpaces: function (value) {
            return !value.includes(' ');
        },

        /**
         * Validates App Name (call with the trimmed value) - letters (any script, including
         * combining marks), digits, spaces and . _ ' - only, no leading/trailing whitespace,
         * at most MAX_LENGTH_APP_NAME
         * @param {string} value - The app name to validate
         * @returns {boolean} - True if valid
         */
        validateAppName: function (value) {
            if (typeof value !== 'string') return false;
            if (value.length === 0 || value.length > MAX_LENGTH_APP_NAME) return false;
            if (value.trim() !== value) return false;
            return /^[\p{L}\p{M}\p{N} ._'-]+$/u.test(value);
        },

        /**
         * Validates Package Name format
         * Must start with a letter, contain at least 3 segments separated by dots,
         * and use only lowercase letters and numbers. No segment may be a Java keyword or a
         * Kotlin hard keyword, and the reserved package (see configure) and packages under it are rejected.
         * Example: com.example.app
         * @param {string} value - The package name to validate
         * @returns {boolean} - True if valid
         */
        validatePackageName: function (value) {
            if (!PATTERNS.packageName.test(value)) return false;
            if (value.split('.').some(isKeyword)) return false;
            if (RESERVED_PACKAGE_PREFIX &&
                (value === RESERVED_PACKAGE_PREFIX || value.indexOf(RESERVED_PACKAGE_PREFIX + '.') === 0)) {
                return false;
            }
            return true;
        },

        /**
         * Validates URL - http(s) only, at most MAX_LENGTH_BASE_URL characters, and free of
         * characters that would break the generated Kotlin string (" \ $, whitespace, controls)
         * @param {string} value - The URL to validate
         * @returns {boolean} - True if valid URL
         */
        validateUrl: function (value) {
            if (typeof value !== 'string') return false;
            if (value.length > MAX_LENGTH_BASE_URL) return false;
            if (/["\\$\s\u0000-\u001F\u007F]/.test(value)) return false;
            try {
                const url = new URL(value);
                return url.protocol === 'http:' || url.protocol === 'https:';
            } catch (_) {
                return false;
            }
        },

        /**
         * Validates module count against maximum limit
         * @param {number} count - Number of modules
         * @returns {boolean} - True if count is valid (at or below limit)
         */
        validateModuleCount: function (count) {
            return count <= MAX_MODULES;
        },

        /**
         * Checks if more modules can be added
         * @param {number} currentCount - Current number of modules
         * @returns {boolean} - True if can add more modules
         */
        canAddModule: function (currentCount) {
            return currentCount < MAX_MODULES;
        },

        /**
         * Validates Project Name - only letters allowed (a-zA-Z)
         * @param {string} value - The project name to validate
         * @returns {boolean} - True if valid
         */
        validateProjectName: function (value) {
            return PATTERNS.projectName.test(value);
        },

        /**
         * Sanitizes Project Name - removes all non-letter characters
         * @param {string} value - The input value
         * @returns {string} - Sanitized value
         */
        sanitizeProjectName: function (value) {
            return value.replace(/[^a-zA-Z]/g, '');
        },

        /**
         * Sanitizes Package Name - lowercase, only a-z, 0-9 and . allowed, no consecutive dots
         * (same character set as validatePackageName, so typing cannot produce a rejected char)
         * @param {string} value - The input value
         * @returns {string} - Sanitized value
         */
        sanitizePackageName: function (value) {
            return value.toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/\.{2,}/g, '.');
        },

        /**
         * Sanitizes App Name - no leading spaces, no consecutive spaces
         * @param {string} value - The input value
         * @returns {string} - Sanitized value
         */
        sanitizeAppName: function (value) {
            return value.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
        },

        /**
         * Sanitizes Module Name - lowercase, a-z and 0-9 allowed, removes leading digits
         * @param {string} value - The input value
         * @returns {string} - Sanitized value
         */
        sanitizeModuleName: function (value) {
            let sanitized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Remove leading digits (module name must start with a letter)
            while (sanitized.length > 0 && /^[0-9]/.test(sanitized)) {
                sanitized = sanitized.substring(1);
            }
            return sanitized;
        },

        /**
         * Validates Module Name - lowercase letters and numbers allowed, must start with letter,
         * must not be a Java or Kotlin hard keyword (it becomes a package segment) or a reserved name
         * (RESERVED_MODULE_NAMES)
         * @param {string} value - The module name to validate
         * @returns {boolean} - True if valid
         */
        validateModuleName: function (value) {
            return PATTERNS.moduleName.test(value) && value.length > 0 && !isKeyword(value) &&
                RESERVED_MODULE_NAMES.indexOf(value) === -1;
        },

        /**
         * Sanitizes Android Min SDK - only digits allowed
         * @param {string} value - The input value
         * @returns {string} - Sanitized value (digits only)
         */
        sanitizeMinSdk: function (value) {
            return value.replace(/[^0-9]/g, '');
        },

        /**
         * Validates Android Min SDK - must be a valid number within range
         * @param {number|string} value - The min SDK value
         * @returns {boolean} - True if valid (number between MIN_SDK_MIN and MIN_SDK_MAX)
         */
        validateMinSdk: function (value) {
            if (!/^\d{1,2}$/.test(value)) return false;
            const num = parseInt(value, 10);
            return num >= MIN_SDK_MIN && num <= MIN_SDK_MAX;
        },

        /**
         * Sanitizes iOS Version - only digits and dots, max 2 dots, no consecutive dots
         * @param {string} value - The input value
         * @returns {string} - Sanitized value
         */
        sanitizeIosVersion: function (value) {
            // Remove non-digit and non-dot characters
            let sanitized = value.replace(/[^0-9.]/g, '');
            // Remove consecutive dots
            sanitized = sanitized.replace(/\.{2,}/g, '.');
            // Remove leading dot
            if (sanitized.startsWith('.')) {
                sanitized = sanitized.substring(1);
            }
            // Limit to max 2 dots (major.minor.patch)
            const parts = sanitized.split('.');
            if (parts.length > 3) {
                sanitized = parts.slice(0, 3).join('.');
            }
            return sanitized;
        },

        /**
         * Validates iOS Version format and range
         * @param {string} value - The iOS version string
         * @returns {boolean} - True if valid format and within range
         */
        validateIosVersion: function (value) {
            // Check format first
            if (!PATTERNS.iosVersionFormat.test(value)) return false;
            // Check range
            return compareVersions(value, IOS_VERSION_MIN) >= 0 &&
                compareVersions(value, IOS_VERSION_MAX) <= 0;
        },

        /**
         * Error messages for validation failures
         */
        messages: {
            projectNameSpaces: 'Project Name cannot contain spaces',
            projectNameInvalid: 'Project Name must contain only letters (a-z, A-Z)',
            projectNameTooLong: 'Project Name must be at most ' + MAX_LENGTH_PROJECT_NAME + ' characters',
            packageNameSpaces: 'Package Name cannot contain spaces',
            packageNameInvalid: 'Invalid Package Name. Must start with a letter, contain at least two dots (3 segments), and use only lowercase letters and numbers (e.g., com.example.app). Segments cannot be Java or Kotlin keywords (e.g., in, is, object, new, int), and the template\'s reserved package (or any package under it) cannot be used.',
            packageNameTooLong: 'Package Name must be at most ' + MAX_LENGTH_PACKAGE_NAME + ' characters',
            appNameInvalid: 'App Name must be 1-' + MAX_LENGTH_APP_NAME + ' characters using only letters, numbers, spaces and . _ \' - (no leading or trailing spaces)',
            urlInvalid: 'Invalid Base URL. Please enter a valid http(s) URL of at most ' + MAX_LENGTH_BASE_URL + ' characters without spaces, quotes, backslashes or $ (e.g., https://api.example.com)',
            maxModulesReached: 'Maximum ' + MAX_MODULES + ' feature modules allowed',
            moduleNameInvalid: 'Module name must start with a letter, contain only lowercase letters and numbers (a-z, 0-9), and not be a Java or Kotlin keyword (e.g., in, is, object, new, int) or one of the reserved names (' + RESERVED_MODULE_NAMES.join(', ') + ')',
            moduleNameTooLong: 'Module name must be at most ' + MAX_LENGTH_MODULE_NAME + ' characters',
            moduleNameDuplicate: 'Each module name can be used only once',
            minSdkInvalid: 'Min SDK must be a number between ' + MIN_SDK_MIN + ' and ' + MIN_SDK_MAX + '',
            iosVersionInvalid: 'iOS Version must be between ' + IOS_VERSION_MIN + ' and ' + IOS_VERSION_MAX
        }
    };

    return ProjectValidator;
}));
