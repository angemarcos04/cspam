<?php

namespace App\Support\Schools;

final class SchoolCoverage
{
    public const CANONICAL_VALUES = [
        'Elementary',
        'Junior High',
        'Senior High',
        'Elementary / Junior High',
        'Elementary / Senior High',
        'Junior High / Senior High',
        'Elementary / Junior High / Senior High',
        'High School',
    ];

    private const LABELS = [
        'elementary' => 'Elementary',
        'junior_high' => 'Junior High',
        'senior_high' => 'Senior High',
    ];

    private const ORDER = ['elementary', 'junior_high', 'senior_high'];

    /**
     * @return array{tokens: list<string>, legacyHighSchool: bool, unknownLabel: string|null}
     */
    public static function parse(mixed $value): array
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return ['tokens' => [], 'legacyHighSchool' => false, 'unknownLabel' => null];
        }

        $tokens = [];
        $legacyHighSchool = false;
        $unknownLabel = null;
        $parts = preg_split('/\s*(?:\/|,|&|\+|\|)\s*/', $raw) ?: [];
        $parts = array_values(array_filter($parts, static fn (string $part): bool => trim($part) !== ''));

        foreach ($parts !== [] ? $parts : [$raw] as $part) {
            $token = self::tokenForPart($part);
            if ($token === 'legacy_high_school') {
                $legacyHighSchool = true;
                continue;
            }
            if ($token !== null) {
                $tokens[$token] = true;
                continue;
            }
            $unknownLabel ??= trim($part);
        }

        return [
            'tokens' => array_values(array_filter(self::ORDER, static fn (string $token): bool => isset($tokens[$token]))),
            'legacyHighSchool' => $legacyHighSchool,
            'unknownLabel' => $unknownLabel,
        ];
    }

    public static function normalize(mixed $value): ?string
    {
        $parsed = self::parse($value);
        if ($parsed['tokens'] !== []) {
            return self::tokensToStoredLevel($parsed['tokens']);
        }
        if ($parsed['legacyHighSchool'] && $parsed['unknownLabel'] === null) {
            return 'High School';
        }

        return null;
    }

    /**
     * @param list<string> $tokens
     */
    public static function tokensToStoredLevel(array $tokens): string
    {
        $tokenSet = array_fill_keys($tokens, true);
        $labels = [];
        foreach (self::ORDER as $token) {
            if (isset($tokenSet[$token])) {
                $labels[] = self::LABELS[$token];
            }
        }

        return implode(' / ', $labels);
    }

    public static function hasToken(mixed $value, string $token): bool
    {
        $parsed = self::parse($value);

        return in_array($token, $parsed['tokens'], true);
    }

    public static function isLegacyHighSchool(mixed $value): bool
    {
        $parsed = self::parse($value);

        return $parsed['legacyHighSchool'] && $parsed['tokens'] === [] && $parsed['unknownLabel'] === null;
    }

    private static function tokenForPart(string $part): ?string
    {
        $normalized = preg_replace('/\s+/', ' ', str_replace(['_', '-'], ' ', strtolower(trim($part))));

        return match ($normalized) {
            'elementary', 'elem' => 'elementary',
            'junior high', 'junior high school', 'jhs' => 'junior_high',
            'senior high', 'senior high school', 'shs' => 'senior_high',
            'high school', 'secondary' => 'legacy_high_school',
            default => null,
        };
    }
}
