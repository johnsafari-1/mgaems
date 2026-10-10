<?php

namespace App\Services;

use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class HealthOperations
{
    public function run(Request $request, callable $operation, string $mode = 'manage')
    {
        try {
            return DB::transaction(function () use ($request, $operation, $mode) {
                [$actor, $staff] = (new HealthAccess)->actor($request, $mode, true);

                return $operation($actor, $staff);
            }, 3);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $exception) {
            return response()->json(['message' => 'Not Found.'], 404);
        } catch (ValidationException|HttpResponseException|HttpException $exception) {
            throw $exception;
        } catch (QueryException $exception) {
            if (in_array((string) $exception->getCode(), ['23000', '23505'], true)) {
                (new HealthHistory)->conflict('RECORD_CONFLICT');
            }

            return $this->failed();
        } catch (\Throwable $exception) {
            return $this->failed();
        }
    }

    private function failed()
    {
        // Never report raw SQL/exception messages: bindings can contain health narratives.
        return response()->json(['error' => [
            'code' => 'HEALTH_OPERATION_FAILED', 'message' => 'The health operation could not be completed. No changes were committed.',
        ]], 503);
    }
}
