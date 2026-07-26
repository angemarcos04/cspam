$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDirectory = Split-Path -Parent $scriptDirectory
$templateDirectory = Join-Path $frontendDirectory "public\templates\fm-qad"
$requiredEntries = @(
    "[Content_Types].xml"
    "_rels/.rels"
    "word/document.xml"
)

if (-not (Test-Path -LiteralPath $templateDirectory -PathType Container)) {
    throw "FM-QAD template directory does not exist: $templateDirectory"
}

$docxFiles = @(
    Get-ChildItem -LiteralPath $templateDirectory -File |
        Where-Object { $_.Extension -ieq ".docx" } |
        Sort-Object Name
)

if ($docxFiles.Count -eq 0) {
    throw "No DOCX templates were found in: $templateDirectory"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

foreach ($file in $docxFiles) {
    if ($file.Length -le 0) {
        throw "$($file.Name) is empty"
    }

    $archive = $null

    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($file.FullName)
        $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })

        foreach ($requiredEntry in $requiredEntries) {
            if ($entryNames -notcontains $requiredEntry) {
                throw "$($file.Name) is missing required DOCX entry: $requiredEntry"
            }
        }

        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith("/")) {
                continue
            }

            $stream = $null

            try {
                $stream = $entry.Open()
                $buffer = New-Object byte[] 8192

                while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) {
                }
            }
            finally {
                if ($null -ne $stream) {
                    $stream.Dispose()
                }
            }
        }
    }
    catch {
        throw "$($file.Name) failed DOCX integrity validation: $($_.Exception.Message)"
    }
    finally {
        if ($null -ne $archive) {
            $archive.Dispose()
        }
    }

    Write-Output "OK $($file.Name)"
}

Write-Output "Validated $($docxFiles.Count) FM-QAD DOCX templates."
