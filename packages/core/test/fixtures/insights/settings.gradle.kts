rootProject.name = "Multiplatform"
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

include(":shared")
include(":androidApp")
include(":core:domain")
include(":core:insights")
include(":core:navigation")
includeBuild("build-logic")
