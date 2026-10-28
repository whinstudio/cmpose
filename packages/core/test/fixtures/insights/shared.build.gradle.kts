plugins {
    alias(libs.plugins.kmp.library.plugin)
}

kotlin {
    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "Shared"
            // Swift implements core:insights' IosInsightsBridge and hands it to IosInsights.register
            export(projects.core.insights)
        }
    }
    sourceSets {
        commonMain.dependencies {
            api(projects.core.insights)
            implementation(projects.core.domain)
            implementation(projects.core.navigation)
        }
    }
}
